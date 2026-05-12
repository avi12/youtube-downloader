import { ensureProcessor } from "../handlers/processor";
import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { downloadViaCdn } from "./cdn-downloader";
import { downloadViaWatchPage } from "./iframe-downloader";
import { downloadViaSabr } from "./sabr-downloader";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import { stripMimeParams } from "@/lib/utils/containers";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube/youtube-music-metadata";
import { AUDIO_EXTRA_STREAM_PREFIX, ProgressType, StreamType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

export interface DownloadResult {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: Array<{
    data: Uint8Array | null;
    mimeType: string;
    label: string;
    languageCode: string;
    isDefault: boolean;
  }>;
  isPartialVideo?: boolean;
  isPartialAudio?: boolean;
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
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: request.videoId,
      progress: 0,
      progressType: ProgressType.Video
    }, tabId);
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

// Drop a pending auto-retry and any persisted interrupted state for this video.
// Used by CancelDownload so a manual cancel never gets resurrected by the next
// `online` event or page-load.
export function dropPendingRetry(videoId: string) {
  pendingNetworkRetries.delete(videoId);
  void clearInterruptedDownload(videoId);
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

async function dispatchToOffscreen({ request, result, enrichedMetadata, tabId }: {
  request: DownloadRequest;
  result: DownloadResult;
  enrichedMetadata: VideoMetadata | null | undefined;
  tabId: number;
}) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId: request.videoId,
    progress: 0,
    progressType: ProgressType.FFmpeg
  }, tabId);
  await ensureProcessor();

  const {
    videoId, type, filenameOutput, videoFormat, audioFormat,
    primaryAudioLabel, captionTracks, playlistId, playlistTitle, playlistTotalCount
  } = request;
  const { videoData, audioData, additionalAudioTracks } = result;

  const resolvedVideoMimeType = videoFormat ? stripMimeParams(videoFormat.mimeType) : "video/mp4";
  const resolvedAudioMimeType = audioFormat ? stripMimeParams(audioFormat.mimeType) : "audio/mp4";
  const transferJobs: Promise<void>[] = [];
  if (videoData) {
    transferJobs.push(
      sendStreamChunksToOffscreen({
        videoId,
        streamType: StreamType.Video,
        data: videoData,
        tabId
      })
    );
  }

  if (audioData) {
    transferJobs.push(
      sendStreamChunksToOffscreen({
        videoId,
        streamType: StreamType.Audio,
        data: audioData,
        tabId
      })
    );
  }

  for (const [i, track] of additionalAudioTracks.entries()) {
    if (track.data) {
      transferJobs.push(
        sendStreamChunksToOffscreen({
          videoId,
          streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${i}`,
          data: track.data,
          tabId
        })
      );
    }
  }

  await Promise.all(transferJobs);

  const audioTrackLabels = [
    primaryAudioLabel ?? "",
    ...additionalAudioTracks.map(track => track.label)
  ];
  const audioTrackLanguages = [
    request.primaryAudioLanguageCode ?? "",
    ...additionalAudioTracks.map(track => track.languageCode)
  ];

  const defaultAudioTrackIndex = 0;

  const captionVttData = request.captionVttData ?? [];
  const subtitleTracks: {
    dataBase64: string;
    label: string;
    languageCode: string;
  }[] = [];
  for (const [i, track] of (captionTracks ?? []).entries()) {
    const dataBase64 = captionVttData[i];
    if (dataBase64) {
      subtitleTracks.push({
        dataBase64,
        label: track.name.simpleText,
        languageCode: track.languageCode
      });
    }
  }

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type,
    videoId,
    filenameOutput,
    videoMimeType: resolvedVideoMimeType,
    audioMimeType: resolvedAudioMimeType,
    audioTrackLabels,
    audioTrackLanguages,
    defaultAudioTrackIndex,
    subtitleTracks,
    tabId,
    playlistId,
    playlistTitle,
    playlistTotalCount,
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

async function queueNetworkRetry({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  pendingNetworkRetries.set(request.videoId, {
    request,
    tabId
  });
  await persistInterruptedDownload(request);
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId: request.videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isInterrupted: true
  }, tabId);
}

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
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
  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);

    let result = await attemptSabrDownload({
      request,
      signal,
      tabId
    }).catch(sabrError => {
      if (signal.aborted) {
        throw sabrError;
      }

      console.warn("[ytdl:bg] SABR failed, trying CDN:", sabrError);
      // Resets the UI to indeterminate rather than a frozen percentage while CDN starts.
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      return null;
    });
    if (signal.aborted) {
      return;
    }

    const needsCdn = !result?.audioData || result.isPartialVideo || result.isPartialAudio;
    if (needsCdn) {
      // Pass SABR partial bytes so CDN resumes from the stall point via Range request
      result = await downloadViaCdn({
        request,
        signal,
        videoId,
        tabId,
        partialVideoData: result?.isPartialVideo ? (result.videoData ?? undefined) : undefined,
        partialAudioData: result?.isPartialAudio ? (result.audioData ?? undefined) : undefined
      });
    }

    if (signal.aborted) {
      return;
    }

    if (!result?.audioData && !result?.videoData) {
      if (request.isIframeFallback) {
        console.warn("[ytdl:bg] All download methods (including iframe) failed for", videoId);
        reportDownloadFailed({
          videoId,
          tabId
        });
        return;
      }

      console.warn("[ytdl:bg] SABR+CDN failed, trying offscreen iframe fallback for", videoId);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      await downloadViaWatchPage({
        data: request,
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
      await queueNetworkRetry({
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
