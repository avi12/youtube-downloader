import { startIframeScrubSession } from "../handlers/iframe-scrub-orchestrator";
import { ensureProcessor } from "../handlers/processor";
import { removeHostedIframe, spawnHostedIframe } from "../iframe-host/iframe-host";
import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { downloadViaCdn } from "./cdn-downloader";
import { createProgressFetch } from "./progress-fetch";
import { downloadViaSabr, downloadViaSabrWithTrustTemplate } from "./sabr-downloader";
import { downloadViaSabrProgressive } from "./sabr-progressive";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { TRANSFER_CHUNK_SIZE, base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { fetchAlternateClientFormats, findFormatUrlByItag } from "@/lib/youtube/alternate-client";
import { debugRangedSabr } from "@/lib/youtube/sabr-download";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube/youtube-music-metadata";
import { ProgressType, StreamType } from "@/types";
import type { CaptionTrack, DownloadRequest, SubtitleStream, VideoMetadata } from "@/types";

// On Firefox, direct SABR returns attestation_required for videos beyond
// roughly this duration; falls back to iframe-scrub which fetches via the
// player's trusted live session.
const FIREFOX_IFRAME_SCRUB_FALLBACK_MIN_DURATION_SEC = 240;

// Max time we wait for a factory tab to play through ads + capture a non-ad
// SABR template. Pre-roll ads are typically ~100s; some are skippable.
const FACTORY_TAB_TIMEOUT_MS = 180_000;

// Key by factoryId (when set) for parallel offset harvesting; fall back to
// videoId for the single-factory path.
const pendingFactoryTemplates = new Map<string, (template: {
  url: string;
  bodyBase64: string;
  capturedAt: number;
} | null) => void>();

onMessage(MessageType.SabrTemplateReady, ({ data }) => {
  const key = data.factoryId || data.videoId;
  const resolver = pendingFactoryTemplates.get(key);
  if (resolver) {
    pendingFactoryTemplates.delete(key);
    resolver({
      url: data.url,
      bodyBase64: data.bodyBase64,
      capturedAt: data.capturedAt
    });
  }
});

async function spawnFactoryTabAndAwaitTemplate({ videoId, tabId, offsetSec }: {
  videoId: string;
  tabId: number;
  offsetSec?: number;
}): Promise<{
  url: string;
  bodyBase64: string;
  capturedAt: number;
} | null> {
  // Hidden iframe inside the BG/offscreen page loads the watch page. The
  // interceptor inside it captures the first post-ad SABR call; ISOLATED
  // forwards via SabrTemplateReady, keyed by factoryId so multiple parallel
  // factory iframes (one per offset) can race-free coexist.
  const iframeId = `factory:${videoId}:${offsetSec ?? 0}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const tParam = typeof offsetSec === "number" && offsetSec > 0 ? `&t=${offsetSec}` : "";
  const url = `https://www.youtube.com/watch?v=${videoId}&ytdl=1&ytdlTrustFactoryMode=1&ytdlFactoryId=${encodeURIComponent(iframeId)}${tParam}`;
  try {
    await spawnHostedIframe({
      id: iframeId,
      url
    });
  } catch (error) {
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:bg-trust-template] factory iframe create failed: ${String(error)}`
    }, tabId);
    return null;
  }

  void sendMessage(MessageType.BgDebugLog, {
    msg: `[ytdl:bg-trust-template] factory iframe id=${iframeId} mounted (t=${offsetSec ?? 0}s), awaiting template`
  }, tabId);

  const template = await new Promise<{
    url: string;
    bodyBase64: string;
    capturedAt: number;
  } | null>(resolve => {
    pendingFactoryTemplates.set(iframeId, resolve);
    setTimeout(() => {
      if (pendingFactoryTemplates.has(iframeId)) {
        pendingFactoryTemplates.delete(iframeId);
        resolve(null);
      }
    }, FACTORY_TAB_TIMEOUT_MS);
  });

  removeHostedIframe(iframeId);

  return template;
}

export async function harvestFreshTemplate({ videoId, tabId, offsetSec }: {
  videoId: string;
  tabId: number;
  offsetSec: number;
}) {
  return spawnFactoryTabAndAwaitTemplate({
    videoId,
    tabId,
    offsetSec
  });
}

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

// Trust-template SABR fallback. Currently disabled in startBackgroundDownload —
// kept around because the chunked-SABR phase 2 inside it now uses the user-tab
// synthesizer (no factory iframes) and may be worth re-enabling if iframe-scrub
// regresses again on Firefox.
async function _attemptTrustTemplateSabrDownload({ request, signal, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}) {
  // Fast path: ISOLATED already caches the latest template the user's tab
  // observed via the passive interceptor. Interceptor's ad-skip filter ensures
  // it's post-ad. No player manipulation — just observation.
  let template = await sendMessage(MessageType.GetSabrTemplateFromTab, {}, tabId).catch(() => null);
  if (template) {
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:bg-trust-template] using user-tab template (age=${Date.now() - template.capturedAt}ms)`
    }, tabId);
  } else {
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:bg-trust-template] no user-tab template; spawning factory tab for ${request.videoId}`
    }, tabId);
    template = await spawnFactoryTabAndAwaitTemplate({
      videoId: request.videoId,
      tabId
    });
  }
  if (!template) {
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:bg-trust-template] factory tab timed out without capturing a template`
    }, tabId);
    return null;
  }

  const templateBody = base64ToUint8Array(template.bodyBase64);
  void sendMessage(MessageType.BgDebugLog, {
    msg: `[ytdl:bg-trust-template] factory captured (body=${templateBody.byteLength}B age=${Date.now() - template.capturedAt}ms); attempting SabrStream bootstrap`
  }, tabId);

  const sabrAbortController = new AbortController();
  let sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  signal.addEventListener("abort", () => sabrAbortController.abort(), { once: true });

  function resetSabrStallTimer() {
    clearTimeout(sabrStallTimeoutId);
    sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  }

  try {
    // First: progressive parallel chunked SABR — phase 1 bootstraps state via
    // the captured player template, phase 2 fans out one factory-iframe-per-
    // offset to escape the server's per-template quota wall. The factory
    // iframes can each take up to 180s, so the SABR_STALL_TIMEOUT_MS that
    // gates the bootstrap fallback would falsely abort progressive — pause it
    // for the progressive call (progressive has its own per-fetch timeouts).
    clearTimeout(sabrStallTimeoutId);
    const progressive = await downloadViaSabrProgressive({
      request,
      signal: sabrAbortController.signal,
      tabId,
      template
    });
    sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);

    if (progressive) {
      void sendMessage(MessageType.BgDebugLog, {
        msg: `[ytdl:bg-trust-template] sabr-progressive returned `
          + `video=${progressive.videoData?.byteLength ?? 0}B `
          + `audio=${progressive.audioData?.byteLength ?? 0}B`
      }, tabId);
      return progressive;
    }

    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:bg-trust-template] sabr-progressive returned null; falling back to single-session bootstrap`
    }, tabId);

    return await downloadViaSabrWithTrustTemplate({
      request,
      signal: sabrAbortController.signal,
      tabId,
      onProgress: resetSabrStallTimer,
      templateUrl: template.url,
      templateBody,
      onCallLog(msg) {
        void sendMessage(MessageType.BgDebugLog, {
          msg: `[ytdl:bg-trust-template] ${msg}`
        }, tabId);
      }
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
    if (request.debugRangedFromSec !== undefined && request.sabrConfig && request.videoFormat && request.audioFormat) {
      const fetchFn = createProgressFetch({
        signal,
        onBytesReceived() { /* discard bytes — diagnostic only */ }
      });
      await debugRangedSabr({
        sabrConfig: request.sabrConfig,
        videoFormat: request.videoFormat,
        audioFormat: request.audioFormat,
        fetchFn,
        poToken: request.poToken ?? "",
        fromMs: request.debugRangedFromSec * 1000,
        runMs: 30_000
      }).catch(error => {
        console.warn("[ytdl:debug-ranged] threw:", error);
      });
      reportDownloadFailed({
        videoId,
        tabId
      });
      return;
    }

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
