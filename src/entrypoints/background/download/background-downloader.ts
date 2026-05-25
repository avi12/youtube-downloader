import { ensureProcessor } from "../handlers/processor";
import { reportDownloadFailed } from "./download-failure-reporter";
import { enrichMetadataFromYouTubeMusic } from "./metadata-enrichment";
import {
  clearInterruptedDownload,
  dropPendingRetry,
  queueNetworkRetry,
  registerOnlineRetryListener
} from "./network-retry";
import { createPageProxyFetch } from "./page-proxy-fetch";
import { clearIframeAutoRetry } from "./sabr-attempt";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { buildSubtitleTracks, sendNetworkChunkToOffscreen, sendStreamFinishedMarker } from "./stream-chunk-transfer";
import { notifyPlaylistBundleFailure } from "@/lib/download-pipeline/playlist-bundle";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { resolveAndroidUrls } from "@/lib/youtube/android-player";
import { DownloadType, ProgressType, StreamType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

const ANDROID_VR_CHUNK_SIZE = 10 * 1024 * 1024;
const PROGRESS_THROTTLE_MS = 250;

// Chrome MV3 has `chrome.offscreen`. Firefox MV3 does not, so this acts as a
// reliable browser discriminator throughout the download pipeline.
function isFirefoxRuntime() {
  return typeof browser.offscreen === "undefined";
}

type ChunkFetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type FetchAndroidVrChunkedParams = {
  url: string;
  contentLength: number;
  bgFetch: ChunkFetchFn;
  pageProxyFetch: ChunkFetchFn | null;
  onChunk: (chunk: Uint8Array, iChunk: number) => void;
  label: string;
};

// Closed-range chunked GETs (yt-dlp's --http-chunk-size default of 10 MB)
// against ANDROID_VR adaptive CDN URLs. The URLs are self-authenticated by
// signature, so `credentials: "include"` is safe and consistent with the
// rest of the InnerTube auth strategy.
async function fetchAndroidVrChunked({
  url, contentLength, bgFetch, pageProxyFetch, onChunk, label
}: FetchAndroidVrChunkedParams) {
  let byteOffset = 0;
  let iChunk = 0;
  let useBgDirect = true;
  while (byteOffset < contentLength) {
    const rangeEnd = Math.min(byteOffset + ANDROID_VR_CHUNK_SIZE - 1, contentLength - 1);
    const init: RequestInit = {
      credentials: "include",
      headers: {
        Range: `bytes=${byteOffset}-${rangeEnd}`
      }
    };

    let response: Response;
    try {
      const performFetch = useBgDirect ? bgFetch : pageProxyFetch!;
      response = await performFetch(url, init);

      if (response.status !== 206 && response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      const canFallback = useBgDirect && pageProxyFetch;
      if (!canFallback) {
        throw new Error(`${label} chunk fetch failed at offset ${byteOffset}: ${String(err)}`, {
          cause: err
        });
      }

      useBgDirect = false;
      response = await pageProxyFetch!(url, init);

      if (response.status !== 206 && response.status !== 200) {
        throw new Error(`${label} chunk fetch HTTP ${response.status} at offset ${byteOffset} (page-proxy fallback)`, {
          cause: err
        });
      }
    }

    const buffer = await response.arrayBuffer();
    const chunk = new Uint8Array(buffer);
    if (chunk.byteLength === 0) {
      throw new Error(`${label} chunk fetch empty at offset ${byteOffset}`);
    }

    onChunk(chunk, iChunk);
    iChunk++;
    byteOffset += chunk.byteLength;
  }

  return iChunk;
}

type RunFirefoxDirectDownloadParams = {
  request: DownloadRequest;
  tabId: number;
  enrichedMetadata: VideoMetadata | null;
};

// Firefox-only download path. Chrome uses the offscreen-iframe SABR pipeline
// in `download-worker/main.ts`; Firefox can't because YouTube's anti-bot gate
// 403s SABR requests originating from Firefox's TLS fingerprint on Windows
// (regardless of cookies, PO token, or DNR header rewrites).
//
// The bypass mirrors yt-dlp's `android_vr` extractor: hit InnerTube with the
// ANDROID_VR (Oculus Quest YouTube VR app) client, which returns direct CDN
// URLs for every adaptive format with no SABR forcing and no per-request range
// cap. Bytes are then pulled in 10 MB closed-range chunks and streamed to the
// offscreen iframe for FFmpeg muxing on the shared Chrome+Firefox pipeline.
async function runFirefoxDirectDownload({ request, tabId, enrichedMetadata }: RunFirefoxDirectDownloadParams) {
  const { videoId, type, videoItag, audioItag, filenameOutput } = request;
  // Page-proxy routes the InnerTube POST through the watch tab's MAIN-world
  // pristine fetch so cookies + page TLS context pass the anti-bot gate. The
  // BG-direct fetch is tried first as a fast path; if YouTube ever stops
  // 403-ing BG-context InnerTube on Firefox, the page-proxy hop is skipped.
  const pageProxyFetch = tabId >= 0 ? createPageProxyFetch(tabId) : null;
  const isAudioOnly = type === DownloadType.Audio;
  const isVideoOnly = type === DownloadType.Video;
  const wantsVideo = !isAudioOnly;
  const wantsAudio = !isVideoOnly;

  let resolved;
  try {
    resolved = await resolveAndroidUrls({
      videoId,
      videoItag: wantsVideo ? videoItag : undefined,
      audioItag: wantsAudio ? audioItag : undefined
    });
  } catch (bgErr) {
    if (!pageProxyFetch) {
      throw bgErr;
    }

    resolved = await resolveAndroidUrls({
      videoId,
      videoItag: wantsVideo ? videoItag : undefined,
      audioItag: wantsAudio ? audioItag : undefined,
      customFetch: pageProxyFetch
    });
  }

  if (wantsVideo && !resolved.videoUrl) {
    throw new Error(`ANDROID_VR did not return URL for video itag ${videoItag}`);
  }

  if (wantsAudio && !resolved.audioUrl) {
    throw new Error(`ANDROID_VR did not return URL for audio itag ${audioItag}`);
  }

  const totalExpectedBytes = (wantsVideo ? resolved.videoContentLength : 0)
    + (wantsAudio ? resolved.audioContentLength : 0);
  let totalReceivedBytes = 0;
  let lastProgressReport = 0;
  function reportDownloadProgress(force = false) {
    if (totalExpectedBytes === 0) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastProgressReport < PROGRESS_THROTTLE_MS) {
      return;
    }

    lastProgressReport = now;
    const progress = Math.min(totalReceivedBytes / totalExpectedBytes, 1);
    void sendMessageToTab(MessageType.UpdateDownloadProgress, {
      videoId,
      progress,
      progressType: ProgressType.Video
    }, tabId);
  }

  let videoChunkCount = 0;
  let audioChunkCount = 0;
  function bgFetch(input: RequestInfo | URL, init?: RequestInit) {
    return fetch(input, init);
  }

  await Promise.all([
    wantsVideo && resolved.videoUrl ? fetchAndroidVrChunked({
      url: resolved.videoUrl,
      contentLength: resolved.videoContentLength,
      bgFetch,
      pageProxyFetch,
      label: "video",
      onChunk(chunk, iChunk) {
        sendNetworkChunkToOffscreen({
          videoId,
          streamType: StreamType.Video,
          iChunk,
          chunk,
          tabId
        });
        totalReceivedBytes += chunk.byteLength;
        reportDownloadProgress();
        videoChunkCount = iChunk + 1;
      }
    }) : Promise.resolve(),
    wantsAudio && resolved.audioUrl ? fetchAndroidVrChunked({
      url: resolved.audioUrl,
      contentLength: resolved.audioContentLength,
      bgFetch,
      pageProxyFetch,
      label: "audio",
      onChunk(chunk, iChunk) {
        sendNetworkChunkToOffscreen({
          videoId,
          streamType: StreamType.Audio,
          iChunk,
          chunk,
          tabId
        });
        totalReceivedBytes += chunk.byteLength;
        reportDownloadProgress();
        audioChunkCount = iChunk + 1;
      }
    }) : Promise.resolve()
  ]);

  reportDownloadProgress(true);

  if (wantsVideo) {
    sendStreamFinishedMarker({
      videoId,
      streamType: StreamType.Video,
      totalChunks: videoChunkCount,
      tabId
    });
  }

  if (wantsAudio) {
    sendStreamFinishedMarker({
      videoId,
      streamType: StreamType.Audio,
      totalChunks: audioChunkCount,
      tabId
    });
  }

  const videoFormat = request.videoFormat ?? null;
  const audioFormat = request.audioFormat ?? null;
  const videoMimeType = videoFormat ? stripMimeParams(videoFormat.mimeType) : "video/mp4";
  const audioMimeType = audioFormat ? stripMimeParams(audioFormat.mimeType) : "audio/mp4";
  const subtitleTracks = buildSubtitleTracks({
    captionTracks: request.captionTracks,
    captionVttData: request.captionVttData ?? []
  });

  sendToOffscreen({
    type: OffscreenMessageType.ProcessStreamEnd,
    data: {
      type,
      videoId,
      filenameOutput,
      videoMimeType,
      audioMimeType,
      audioTrackLabels: [request.primaryAudioLabel ?? ""],
      audioTrackLanguages: [request.primaryAudioLanguageCode ?? ""],
      defaultAudioTrackIndex: 0,
      subtitleTracks,
      tabId,
      playlistId: request.playlistId,
      playlistTitle: request.playlistTitle,
      playlistTotalCount: request.playlistTotalCount,
      metadata: enrichedMetadata
    }
  });
}

export type { DownloadResult } from "./download-result-types";
export { dropPendingRetry, reportDownloadFailed };

registerOnlineRetryListener(startBackgroundDownload);

export function cancelBackgroundDownload(_videoId: string) {}

type StartBackgroundDownloadParams = {
  request: DownloadRequest;
  tabId: number;
};
export async function startBackgroundDownload({ request, tabId }: StartBackgroundDownloadParams) {
  const { videoId, metadata } = request;
  if (!request.isIframeFallback) {
    clearIframeAutoRetry(videoId);
  }

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);
    const isAudioOnly = request.type === DownloadType.Audio;
    const isSabrConfigPresent = !!(request.sabrConfig && request.audioFormat);
    const isAudioOnlyWithSabr = isAudioOnly && isSabrConfigPresent;
    if (isAudioOnlyWithSabr) {
      await ensureProcessor();
      const effectiveSabrConfig = buildEffectiveSabrConfig({
        sabrConfig: request.sabrConfig!,
        sabrUrl: request.sabrUrl
      });
      const subtitleTracks = buildSubtitleTracks({
        captionTracks: request.captionTracks,
        captionVttData: request.captionVttData ?? []
      });
      sendToOffscreen({
        type: OffscreenMessageType.DownloadAudioViaSabr,
        data: {
          videoId,
          tabId,
          sabrConfig: effectiveSabrConfig,
          audioFormat: request.audioFormat!,
          poToken: request.poToken ?? "",
          type: request.type,
          filenameOutput: request.filenameOutput,
          audioMimeType: stripMimeParams(request.audioFormat!.mimeType),
          audioTrackLabels: [request.primaryAudioLabel ?? ""],
          audioTrackLanguages: [request.primaryAudioLanguageCode ?? ""],
          subtitleTracks,
          playlistId: request.playlistId,
          playlistTitle: request.playlistTitle,
          playlistTotalCount: request.playlistTotalCount,
          enrichedMetadata: (await enrichedMetadataPromise) ?? null
        }
      });
      await clearInterruptedDownload(videoId);
      return;
    }

    await ensureProcessor();

    // Firefox: bypass SABR entirely via the ANDROID_VR path (see `runFirefoxDirectDownload`).
    if (isFirefoxRuntime()) {
      await runFirefoxDirectDownload({
        request,
        tabId,
        enrichedMetadata: (await enrichedMetadataPromise) ?? null
      });
      await clearInterruptedDownload(videoId);
      return;
    }

    // Chrome: hand off to the offscreen worker iframe, which tries SABR first
    // and falls back to direct CDN if SABR stalls/fails. See `download-worker/main.ts`.
    sendToOffscreen({
      type: OffscreenMessageType.StartDownloadInIframe,
      data: {
        request,
        tabId,
        enrichedMetadata: (await enrichedMetadataPromise) ?? null
      }
    });
  } catch (error) {
    const isOffline = !navigator.onLine;
    if (isOffline) {
      await queueNetworkRetry({
        request,
        tabId
      });
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);

    if (request.playlistId) {
      notifyPlaylistBundleFailure(request.playlistId);
    }

    void reportDownloadFailed({
      videoId,
      tabId
    });
  }
}
