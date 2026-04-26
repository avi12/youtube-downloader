import { startIframeScrubSession } from "../handlers/iframe-scrub-orchestrator";
import { ensureProcessor } from "../handlers/processor";
import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { downloadViaCdn } from "./cdn-downloader";
import { downloadViaSabr } from "./sabr-downloader";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import { fetchAlternateClientFormats, findFormatUrlByItag } from "@/lib/youtube/alternate-client";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube/youtube-music-metadata";
import { ProgressType, StreamType } from "@/types";
import type { CaptionTrack, DownloadRequest, SubtitleStream, VideoMetadata } from "@/types";

// On Firefox, direct SABR returns attestation_required for videos beyond
// roughly this duration; falls back to iframe-scrub which fetches via the
// player's trusted live session.
const FIREFOX_IFRAME_SCRUB_FALLBACK_MIN_DURATION_SEC = 240;

export interface DownloadResult {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: Array<{
    data: Uint8Array | null;
    mimeType: string;
    label: string;
  }>;
}

const activeBackgroundDownloads = new Map<string, AbortController>();

// How long SABR can go without delivering any bytes before falling back to CDN.
// A stall (no bytes received) is distinct from a slow connection: slow downloads
// keep resetting this timer and are never killed, while a frozen SABR session
// (re-downloading a recently-fetched video) gets detected and CDN is tried.
const SABR_STALL_TIMEOUT_MS = 30_000;
const pendingNetworkRetries = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

addEventListener("online", () => {
  const retries = [...pendingNetworkRetries.values()];
  pendingNetworkRetries.clear();
  for (const { request, tabId } of retries) {
    void startBackgroundDownload({
      request,
      tabId
    });
  }
});

async function persistInterruptedDownload(request: DownloadRequest) {
  await mutateStorageItem(interruptedDownloadsItem, current => {
    current[request.videoId] = {
      videoId: request.videoId,
      type: request.type,
      filenameOutput: request.filenameOutput,
      videoItag: request.videoItag,
      audioItag: request.audioItag,
      timestamp: Date.now()
    };
  });
}

async function clearInterruptedDownload(videoId: string) {
  await mutateStorageItem(interruptedDownloadsItem, current => {
    delete current[videoId];
  });
}

const YIELD_EVERY_N_CHUNKS = 32;

async function sendStreamChunksToOffscreen({ videoId, streamType, data, tabId }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
  tabId: number;
}) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(chunk),
      tabId
    });

    if ((iChunk + 1) % YIELD_EVERY_N_CHUNKS === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

async function fetchSubtitleSrt(track: CaptionTrack): Promise<string> {
  try {
    const url = new URL(track.baseUrl);
    url.searchParams.set("fmt", "srt");
    const response = await fetch(url.toString());
    if (!response.ok) {
      return "";
    }

    return response.text();
  } catch {
    return "";
  }
}

async function fetchSubtitleStreams(captionTracks: CaptionTrack[]): Promise<SubtitleStream[]> {
  const results = await Promise.all(
    captionTracks.map(async track => ({
      srtContent: await fetchSubtitleSrt(track),
      languageCode: track.languageCode,
      label: track.name.simpleText
    }))
  );
  return results.filter(stream => stream.srtContent);
}

async function dispatchToOffscreen({ request, result, enrichedMetadata, tabId }: {
  request: DownloadRequest;
  result: DownloadResult;
  enrichedMetadata: VideoMetadata | null | undefined;
  tabId: number;
}) {
  await ensureProcessor();

  const resolvedVideoMimeType = request.videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
  const resolvedAudioMimeType = request.audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
  const transferJobs: Promise<void>[] = [];
  if (result.videoData) {
    transferJobs.push(
      sendStreamChunksToOffscreen({
        videoId: request.videoId,
        streamType: StreamType.Video,
        data: result.videoData,
        tabId
      })
    );
  }

  if (result.audioData) {
    transferJobs.push(
      sendStreamChunksToOffscreen({
        videoId: request.videoId,
        streamType: StreamType.Audio,
        data: result.audioData,
        tabId
      })
    );
  }

  for (const [i, track] of result.additionalAudioTracks.entries()) {
    if (track.data) {
      transferJobs.push(
        sendStreamChunksToOffscreen({
          videoId: request.videoId,
          streamType: `audio-extra-${i}`,
          data: track.data,
          tabId
        })
      );
    }
  }

  const [subtitleStreams] = await Promise.all([
    fetchSubtitleStreams(request.captionTracks ?? []),
    Promise.all(transferJobs)
  ]);

  const audioTrackLabels = [
    request.primaryAudioLabel ?? "",
    ...result.additionalAudioTracks.map(track => track.label)
  ];

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type: request.type,
    videoId: request.videoId,
    filenameOutput: request.filenameOutput,
    videoMimeType: resolvedVideoMimeType,
    audioMimeType: resolvedAudioMimeType,
    audioTrackLabels,
    subtitleStreams,
    tabId,
    playlistId: request.playlistId,
    playlistTitle: request.playlistTitle,
    playlistTotalCount: request.playlistTotalCount,
    metadata: enrichedMetadata
  });
}

async function enrichMetadataFromYouTubeMusic(metadata: VideoMetadata | null | undefined) {
  if (!metadata?.isMusic) {
    return metadata;
  }

  const searchQuery = `${metadata.artist} ${metadata.title}`.trim();
  if (!searchQuery) {
    return metadata;
  }

  return fetchYouTubeMusicMetadata({
    searchQuery,
    existingMetadata: metadata
  });
}

function reportDownloadFailed({ videoId, tabId }: {
  videoId: string;
  tabId: number;
}) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isFailed: true
  }, tabId);
  void removeFromPopupList(videoId);
  signalVideoComplete(videoId);
}

function queueNetworkRetry({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  pendingNetworkRetries.set(request.videoId, {
    request,
    tabId
  });
  void persistInterruptedDownload(request);
}

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
}

// When the watch page's WEB-client formats are SABR-only (null URLs), re-fetch
// the player response via TVHTML5_SIMPLY_EMBEDDED_PLAYER (yt-dlp's technique):
// that client returns plain URLs and isn't gated by the attestation wall that
// blocks SABR on Firefox.
async function enrichWithAlternateClientUrls(request: DownloadRequest, tabId?: number): Promise<DownloadRequest> {
  const needsVideoUrl = !request.resolvedVideoUrl;
  const needsAudioUrl = !request.resolvedAudioUrl;
  if (!needsVideoUrl && !needsAudioUrl) {
    return request;
  }

  try {
    // Prefer ANDROID_VR-scoped token (generated with clientName=ANDROID_VR at
    // att/get time). Fall back to the WEB token if the alternate mint failed.
    const formats = await fetchAlternateClientFormats({
      videoId: request.videoId,
      poToken: request.alternateClientPoToken || request.poToken || ""
    });
    const enriched: DownloadRequest = { ...request };
    if (needsVideoUrl) {
      enriched.resolvedVideoUrl = findFormatUrlByItag(formats, request.videoItag);
    }

    if (needsAudioUrl) {
      enriched.resolvedAudioUrl = findFormatUrlByItag(formats, request.audioItag);
    }

    const availableItags = formats.map(format => format.itag).join(",");
    const msg = `[ytdl:bg] alternate-client returned ${formats.length} formats (itags=${availableItags}); video itag ${request.videoItag} url=${Boolean(enriched.resolvedVideoUrl)}, audio itag ${request.audioItag} url=${Boolean(enriched.resolvedAudioUrl)}`;
    console.log(msg);

    if (typeof tabId === "number") {
      void sendMessage(MessageType.BgDebugLog, { msg }, tabId);
    }

    return enriched;
  } catch (error) {
    console.warn("[ytdl:bg] Alternate-client fallback failed:", error);

    if (typeof tabId === "number") {
      void sendMessage(MessageType.BgDebugLog, {
        msg: `[ytdl:bg] alternate-client threw: ${String(error)}`
      }, tabId);
    }

    return request;
  }
}

async function attemptSabrDownload({ request, signal, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}) {
  const sabrAbortController = new AbortController();
  let sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  signal.addEventListener("abort", () => sabrAbortController.abort(), { once: true });

  function resetSabrStallTimer() {
    clearTimeout(sabrStallTimeoutId);
    sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  }

  try {
    return await downloadViaSabr({
      request,
      signal: sabrAbortController.signal,
      tabId,
      onProgress: resetSabrStallTimer
    });
  } finally {
    clearTimeout(sabrStallTimeoutId);
  }
}

export async function startBackgroundDownload({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  const { videoId, metadata } = request;
  void sendMessage(MessageType.BgDebugLog, {
    msg: `[ytdl:bg] startBackgroundDownload entry videoId=${videoId} tabId=${tabId} hasVideoFmt=${Boolean(request.videoFormat)} hasAudioFmt=${Boolean(request.audioFormat)} hasResolvedVideo=${Boolean(request.resolvedVideoUrl)} hasResolvedAudio=${Boolean(request.resolvedAudioUrl)}`
  }, tabId);
  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);

    // CDN-first orchestration: when player_response (or alternate-client mint)
    // gives signed direct URLs, skip SABR entirely. CDN is the fastest reliable
    // path - direct ranged GETs to googlevideo, no attestation_required wall,
    // no SABR per-template quota, no factory iframes. SABR fallbacks only kick
    // in when CDN URLs are unavailable.
    let result: DownloadResult | null = null;
    const cdnRequest = await enrichWithAlternateClientUrls(request, tabId);
    const haveCdnUrls = Boolean(cdnRequest.resolvedVideoUrl || cdnRequest.resolvedAudioUrl);
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:bg] CDN-first check: haveUrls=${haveCdnUrls} video=${Boolean(cdnRequest.resolvedVideoUrl)} audio=${Boolean(cdnRequest.resolvedAudioUrl)}`
    }, tabId);

    if (haveCdnUrls) {
      result = await downloadViaCdn({
        request: cdnRequest,
        signal,
        videoId,
        tabId
      }).catch(error => {
        if (signal.aborted) {
          throw error;
        }

        console.warn("[ytdl:bg] CDN-first failed:", error);
        void sendMessage(MessageType.BgDebugLog, {
          msg: `[ytdl:bg] CDN-first threw: ${String(error)}`
        }, tabId);
        return null;
      });
      void sendMessage(MessageType.BgDebugLog, {
        msg: `[ytdl:bg] CDN-first done: video=${result?.videoData?.byteLength ?? 0}B audio=${result?.audioData?.byteLength ?? 0}B`
      }, tabId);
    }

    // iframe-scrub: when CDN URLs are unavailable, use the user-tab player's
    // own decoded buffer (SourceBuffer hook) as the source. The player has
    // already passed YouTube's attestation, so this works where SABR doesn't.
    // Promoted ahead of the broken SABR paths (lib path 403s on long videos,
    // trust-template path infinite-loops on empty UMP responses).
    if (!result?.audioData && !result?.videoData) {
      const durationSec = request.videoDurationSec ?? 0;
      if (import.meta.env.FIREFOX && durationSec >= FIREFOX_IFRAME_SCRUB_FALLBACK_MIN_DURATION_SEC) {
        void sendMessage(MessageType.BgDebugLog, {
          msg: `[ytdl:bg] CDN unavailable; using iframe-scrub for ${videoId} (${durationSec}s)`
        }, tabId);
        await startIframeScrubSession({
          videoId,
          durationSec,
          type: request.type,
          filenameOutput: request.filenameOutput,
          videoMimeType: request.videoFormat?.mimeType?.split(";")[0] || "video/mp4",
          audioMimeType: request.audioFormat?.mimeType?.split(";")[0] || "audio/mp4",
          audioLabel: request.primaryAudioLabel ?? "",
          metadata: request.metadata,
          playlistId: request.playlistId,
          playlistTitle: request.playlistTitle,
          playlistTotalCount: request.playlistTotalCount,
          additionalAudioFormats: cdnRequest.additionalAudioFormats,
          resolvedExtraAudioUrls: cdnRequest.resolvedExtraAudioUrls,
          captionTracks: cdnRequest.captionTracks,
          tabId
        });
        return;
      }
    }

    if (!result?.audioData) {
      result = await attemptSabrDownload({
        request,
        signal,
        tabId
      }).catch(sabrError => {
        if (signal.aborted) {
          throw sabrError;
        }

        console.warn("[ytdl:bg] direct SABR failed:", sabrError);
        void sendMessage(MessageType.UpdateDownloadProgress, {
          videoId,
          progress: 0,
          progressType: ProgressType.Video
        }, tabId);
        return null;
      });
    }

    if (!result?.audioData && !result?.videoData) {
      console.warn("[ytdl:bg] No download method succeeded for", videoId);
      reportDownloadFailed({
        videoId,
        tabId
      });
      return;
    }

    const enrichedMetadata = await enrichedMetadataPromise;
    await dispatchToOffscreen({
      request,
      result,
      enrichedMetadata,
      tabId
    });
    void clearInterruptedDownload(videoId);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    if (!navigator.onLine) {
      queueNetworkRetry({
        request,
        tabId
      });
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);
    reportDownloadFailed({
      videoId,
      tabId
    });
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}
