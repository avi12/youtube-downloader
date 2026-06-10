import { clearCancelledVideo, isVideoCancelled } from "../handlers/pipeline-state";
import { ensureProcessor } from "../handlers/processor";
import { getTabIdsForVideo } from "../queue/tab-tracker";
import { reportDownloadFailed, reportVideoUnavailable } from "./download-failure-reporter";
import { enrichMetadataFromYouTubeMusic } from "./metadata-enrichment";
import {
  clearAutoRetryCounter,
  clearInterruptedDownload,
  dropPendingRetry,
  isRecoverableError,
  isVideoUnavailableError,
  queueNetworkRetry,
  registerOnlineRetryListener,
  scheduleAutoRetry
} from "./network-retry";
import { createPageProxyFetch } from "./page-proxy-fetch";
import { clearIframeAutoRetry } from "./sabr-attempt";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { sendNetworkChunkToOffscreen, sendStreamFinishedMarker } from "./stream-chunk-transfer";
import { buildSubtitleTracks } from "./subtitle-track-builder";
import { notifyPlaylistBundleFailure } from "@/lib/download-pipeline/playlist-bundle";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { resolveAndroidUrls } from "@/lib/youtube/android-player";
import { AUDIO_EXTRA_STREAM_PREFIX, DownloadType, ProgressType, StreamType } from "@/types";
import type { DownloadRequest, Prettify, VideoMetadata } from "@/types";

const ANDROID_VR_CHUNK_SIZE = 10 * 1024 * 1024;
const PROGRESS_THROTTLE_MS = 250;
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_PARTIAL_CONTENT = 206;

const activeFirefoxDownloads = new Map<string, AbortController>();
const cancelledFirefoxDownloads = new Set<string>();

// The request for each in-flight download, keyed by videoId. On Chrome the
// worker download runs async in the offscreen iframe, so a failure reported back
// by message has no request attached; this lets the terminal-failure funnel
// re-dispatch a full fresh attempt. Cleared on completion, cancel, or after
// retries are exhausted.
const inFlightDownloads = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

export function clearInFlightDownload(videoId: string) {
  inFlightDownloads.delete(videoId);
}

// Chrome MV3 has `chrome.offscreen`. Firefox MV3 does not, so this acts as a
// reliable browser discriminator throughout the download pipeline.
function isFirefoxRuntime() {
  return typeof browser.offscreen === "undefined";
}

type ChunkFetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type FetchAndroidVrChunkedParams = Prettify<{
  url: string;
  contentLength: number;
  bgFetch: ChunkFetchFn;
  pageProxyFetch: ChunkFetchFn | null;
  onChunk: (chunk: Uint8Array, iChunk: number) => void;
  label: string;
  signal: AbortSignal;
}>;

// Closed-range chunked GETs (yt-dlp's --http-chunk-size default of 10 MB)
// against ANDROID_VR adaptive CDN URLs. The URLs are self-authenticated by
// signature, so `credentials: "include"` is safe and consistent with the
// rest of the InnerTube auth strategy.
async function fetchAndroidVrChunked({
  url, contentLength, bgFetch, pageProxyFetch, onChunk, label, signal
}: FetchAndroidVrChunkedParams) {
  let byteOffset = 0;
  let iChunk = 0;
  let useBgDirect = true;
  while (byteOffset < contentLength) {
    if (signal.aborted) {
      return iChunk;
    }

    const rangeEnd = Math.min(byteOffset + ANDROID_VR_CHUNK_SIZE - 1, contentLength - 1);
    const init: RequestInit = {
      credentials: "include",
      signal,
      headers: {
        Range: `bytes=${byteOffset}-${rangeEnd}`
      }
    };

    let response: Response;
    try {
      const performFetch = useBgDirect ? bgFetch : pageProxyFetch!;
      response = await performFetch(url, init);

      const isAcceptableStatus = response.status === HTTP_STATUS_PARTIAL_CONTENT || response.status === HTTP_STATUS_OK;
      if (!isAcceptableStatus) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      if (signal.aborted) {
        return iChunk;
      }

      const canFallback = useBgDirect && pageProxyFetch;
      if (!canFallback) {
        throw new Error(`${label} chunk fetch failed at offset ${byteOffset}: ${String(err)}`, {
          cause: err
        });
      }

      useBgDirect = false;
      response = await pageProxyFetch!(url, init);

      const isAcceptableStatus = response.status === HTTP_STATUS_PARTIAL_CONTENT || response.status === HTTP_STATUS_OK;
      if (!isAcceptableStatus) {
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

type RunFirefoxDirectDownloadParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
  enrichedMetadata: VideoMetadata | null;
}>;

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
  const additionalAudioFormats = request.additionalAudioFormats ?? [];
  const extraAudioItags = additionalAudioFormats.map(format => format.itag);

  const abortController = new AbortController();
  activeFirefoxDownloads.set(videoId, abortController);

  if (cancelledFirefoxDownloads.delete(videoId)) {
    activeFirefoxDownloads.delete(videoId);
    return;
  }

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
      audioItag: wantsAudio ? audioItag : undefined,
      extraAudioItags: wantsAudio ? extraAudioItags : undefined
    });
  } catch (bgErr) {
    if (!pageProxyFetch) {
      throw bgErr;
    }

    resolved = await resolveAndroidUrls({
      videoId,
      videoItag: wantsVideo ? videoItag : undefined,
      audioItag: wantsAudio ? audioItag : undefined,
      extraAudioItags: wantsAudio ? extraAudioItags : undefined,
      customFetch: pageProxyFetch
    });
  }

  if (wantsVideo && !resolved.videoUrl) {
    throw new Error(`ANDROID_VR did not return URL for video itag ${videoItag}`);
  }

  if (wantsAudio && !resolved.audioUrl) {
    throw new Error(`ANDROID_VR did not return URL for audio itag ${audioItag}`);
  }

  type StreamDescriptor = {
    url: string;
    contentLength: number;
    streamType: string;
    label: string;
  };
  const streams: StreamDescriptor[] = [];
  if (wantsVideo && resolved.videoUrl) {
    streams.push({
      url: resolved.videoUrl,
      contentLength: resolved.videoContentLength,
      streamType: StreamType.Video,
      label: "video"
    });
  }

  if (wantsAudio && resolved.audioUrl) {
    streams.push({
      url: resolved.audioUrl,
      contentLength: resolved.audioContentLength,
      streamType: StreamType.Audio,
      label: "audio"
    });
  }

  for (const [iExtra, extra] of resolved.extraAudioUrls.entries()) {
    if (extra.url) {
      streams.push({
        url: extra.url,
        contentLength: extra.contentLength,
        streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${iExtra}`,
        label: `audio-extra-${iExtra}`
      });
    }
  }

  const totalExpectedBytes = streams.reduce((total, stream) => total + stream.contentLength, 0);
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
    sendMessageToTab(MessageType.UpdateDownloadProgress, {
      videoId,
      progress,
      progressType: ProgressType.Video
    }, tabId).catch(() => {});
  }

  if (abortController.signal.aborted) {
    return;
  }

  const chunkCounts = new Map<string, number>();
  function bgFetch(input: RequestInfo | URL, init?: RequestInit) {
    return fetch(input, init);
  }

  try {
    await Promise.all(
      streams.map(({ url, contentLength, streamType, label }) =>
        fetchAndroidVrChunked({
          url,
          contentLength,
          bgFetch,
          pageProxyFetch,
          signal: abortController.signal,
          label,
          onChunk(chunk, iChunk) {
            sendNetworkChunkToOffscreen({
              videoId,
              streamType,
              iChunk,
              chunk,
              tabId
            });
            totalReceivedBytes += chunk.byteLength;
            reportDownloadProgress();
            chunkCounts.set(streamType, iChunk + 1);
          }
        }))
    );
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }

    throw err;
  } finally {
    activeFirefoxDownloads.delete(videoId);
  }

  if (abortController.signal.aborted || cancelledFirefoxDownloads.delete(videoId)) {
    return;
  }

  reportDownloadProgress(true);

  for (const { streamType } of streams) {
    sendStreamFinishedMarker({
      videoId,
      streamType,
      totalChunks: chunkCounts.get(streamType) ?? 0,
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

  const audioTrackLabels = [
    request.primaryAudioLabel ?? "",
    ...additionalAudioFormats.map(format => format.audioTrack?.displayName ?? "")
  ];
  const audioTrackLanguages = [
    request.primaryAudioLanguageCode ?? "",
    ...additionalAudioFormats.map(format => format.audioTrack?.id?.split(".")[0] ?? "")
  ];

  sendToOffscreen({
    type: OffscreenMessageType.ProcessStreamEnd,
    data: {
      type,
      videoId,
      filenameOutput,
      videoMimeType,
      audioMimeType,
      audioTrackLabels,
      audioTrackLanguages,
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

// Single funnel for every terminal download failure (worker error, exhausted
// SABR/CDN/iframe fallback). Auto-retries the whole pipeline with backoff before
// surfacing the manual Retry state, so a transient cold-session failure recovers
// on its own instead of silently resetting the button.
type HandleTerminalFailureParams = Prettify<{
  videoId: string;
  tabId: number;
}>;
export async function handleTerminalFailure({ videoId, tabId }: HandleTerminalFailureParams) {
  if (isVideoCancelled(videoId)) {
    clearCancelledVideo(videoId);
    clearAutoRetryCounter(videoId);
    inFlightDownloads.delete(videoId);
    return;
  }

  const inFlight = inFlightDownloads.get(videoId);
  const effectiveTabId = tabId >= 0 ? tabId : (inFlight?.tabId ?? getTabIdsForVideo(videoId)[0] ?? -1);
  if (inFlight) {
    const isRescheduled = await scheduleAutoRetry({
      request: inFlight.request,
      tabId: effectiveTabId,
      startBackgroundDownload
    });
    if (isRescheduled) {
      return;
    }
  }

  clearAutoRetryCounter(videoId);
  inFlightDownloads.delete(videoId);

  if (inFlight?.request.playlistId) {
    notifyPlaylistBundleFailure(inFlight.request.playlistId);
  }

  await reportDownloadFailed({
    videoId,
    tabId: effectiveTabId
  });
}

registerOnlineRetryListener(startBackgroundDownload);

export function cancelBackgroundDownload(videoId: string) {
  cancelledFirefoxDownloads.add(videoId);
  activeFirefoxDownloads.get(videoId)?.abort();
}

type StartBackgroundDownloadParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
}>;
export async function startBackgroundDownload({ request, tabId }: StartBackgroundDownloadParams) {
  const { videoId, metadata } = request;
  inFlightDownloads.set(videoId, {
    request,
    tabId
  });

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
      inFlightDownloads.delete(videoId);
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
    clearAutoRetryCounter(videoId);
  } catch (error) {
    if (isVideoCancelled(videoId)) {
      clearCancelledVideo(videoId);
      clearAutoRetryCounter(videoId);
      inFlightDownloads.delete(videoId);
      return;
    }

    // The video is gone (removed/private/region-blocked) - retrying can't recover
    // it, so skip the retry path and surface the terminal "unavailable" state.
    if (isVideoUnavailableError(error)) {
      clearAutoRetryCounter(videoId);
      inFlightDownloads.delete(videoId);
      await dropPendingRetry(videoId);

      if (request.playlistId) {
        notifyPlaylistBundleFailure(request.playlistId);
      }

      await reportVideoUnavailable({
        videoId,
        tabId
      });
      return;
    }

    const isOffline = !navigator.onLine;
    if (isOffline) {
      await queueNetworkRetry({
        request,
        tabId
      });
      return;
    }

    const isRecoverable = isRecoverableError(error);
    if (isRecoverable) {
      const isRescheduled = await scheduleAutoRetry({
        request,
        tabId,
        startBackgroundDownload
      });
      if (isRescheduled) {
        console.warn("[ytdl:bg] Recoverable error, auto-retrying:", error);
        return;
      }
    }

    console.warn("[ytdl:bg] Background download failed:", error);
    clearAutoRetryCounter(videoId);
    inFlightDownloads.delete(videoId);

    if (request.playlistId) {
      notifyPlaylistBundleFailure(request.playlistId);
    }

    await reportDownloadFailed({
      videoId,
      tabId
    });
  }
}
