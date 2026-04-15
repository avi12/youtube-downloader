import { ensureProcessor } from "../handlers/processor";
import { downloadViaCdn } from "./cdn-downloader";
import { downloadViaSabr } from "./sabr-downloader";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { interruptedDownloadsItem } from "@/lib/storage/storage";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube/youtube-music-metadata";
import { ProgressType, StreamType } from "@/types";
import type { DownloadRequest, InterruptedDownload, VideoMetadata } from "@/types";

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
const pendingNetworkRetries = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

addEventListener("online", () => {
  const retries = [...pendingNetworkRetries.values()];
  pendingNetworkRetries.clear();
  for (const { request, tabId } of retries) {
    void startBackgroundDownload(request, tabId);
  }
});

async function persistInterruptedDownload(request: DownloadRequest) {
  const interrupted: InterruptedDownload = {
    videoId: request.videoId,
    type: request.type,
    filenameOutput: request.filenameOutput,
    videoItag: request.videoItag,
    audioItag: request.audioItag,
    timestamp: Date.now()
  };
  const current = await interruptedDownloadsItem.getValue();
  current[request.videoId] = interrupted;
  await interruptedDownloadsItem.setValue(current);
}

async function clearInterruptedDownload(videoId: string) {
  const current = await interruptedDownloadsItem.getValue();
  if (!(videoId in current)) {
    return;
  }

  delete current[videoId];
  await interruptedDownloadsItem.setValue(current);
}

const TRANSFER_CHUNK_SIZE = 1024 * 1024;
const yieldEveryNChunks = 32;

async function sendStreamChunksToOffscreen(
  videoId: string,
  streamType: string,
  data: Uint8Array,
  tabId: number
) {
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

    if ((iChunk + 1) % yieldEveryNChunks === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

async function dispatchToOffscreen(
  request: DownloadRequest,
  result: DownloadResult,
  enrichedMetadata: VideoMetadata | null | undefined,
  tabId: number
) {
  await ensureProcessor();

  const resolvedVideoMimeType = request.videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
  const resolvedAudioMimeType = request.audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
  const transferJobs: Promise<void>[] = [];
  if (result.videoData) {
    transferJobs.push(sendStreamChunksToOffscreen(request.videoId, StreamType.Video, result.videoData, tabId));
  }

  if (result.audioData) {
    transferJobs.push(sendStreamChunksToOffscreen(request.videoId, StreamType.Audio, result.audioData, tabId));
  }

  for (const [i, track] of result.additionalAudioTracks.entries()) {
    if (track.data) {
      transferJobs.push(sendStreamChunksToOffscreen(request.videoId, `audio-extra-${i}`, track.data, tabId));
    }
  }

  await Promise.all(transferJobs);

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

  return fetchYouTubeMusicMetadata(searchQuery, metadata);
}

function reportDownloadRemoved(videoId: string, tabId: number) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true
  }, tabId);
}

function queueNetworkRetry(request: DownloadRequest, tabId: number) {
  pendingNetworkRetries.set(request.videoId, { request, tabId });
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

export async function startBackgroundDownload(request: DownloadRequest, tabId: number) {
  const { videoId, metadata } = request;
  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);

    let result: DownloadResult | null = null;

    try {
      result = await downloadViaSabr(request, signal, tabId);
    } catch (sabrError) {
      if (signal.aborted) {
        return;
      }

      console.warn("[ytdl:bg] SABR failed, trying CDN:", sabrError);
    }

    if (!result?.audioData) {
      try {
        result = await downloadViaCdn(request, signal, videoId, tabId);
      } catch (cdnError) {
        if (signal.aborted) {
          return;
        }

        if (!navigator.onLine) {
          queueNetworkRetry(request, tabId);
          return;
        }

        console.warn("[ytdl:bg] CDN fetch failed:", cdnError);
        reportDownloadRemoved(videoId, tabId);
        return;
      }
    }

    if (!result?.audioData && !result?.videoData) {
      console.warn("[ytdl:bg] No download method succeeded for", videoId);
      reportDownloadRemoved(videoId, tabId);
      return;
    }

    const enrichedMetadata = await enrichedMetadataPromise;
    await dispatchToOffscreen(request, result, enrichedMetadata, tabId);
    void clearInterruptedDownload(videoId);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    if (!navigator.onLine) {
      queueNetworkRetry(request, tabId);
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);
    reportDownloadRemoved(videoId, tabId);
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}
