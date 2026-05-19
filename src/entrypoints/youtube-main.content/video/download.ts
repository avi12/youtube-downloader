import { resolveAndDispatch } from "./download-execute";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { type DownloadRequest, ProgressType } from "@/types";

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
}

export function cancelAllActiveDownloads() {
  const videoIds = [...activeDownloads.keys()];
  for (const controller of activeDownloads.values()) {
    controller.abort();
  }
  activeDownloads.clear();
  return videoIds;
}

export async function startDownload(params: Pick<DownloadRequest,
  "type" | "videoId" | "videoItag" | "audioItag" | "audioTrackId" |
  "selectedCaptionVssId" | "filenameOutput" | "isIframeFallback" |
  "playlistId" | "playlistTitle" | "playlistTotalCount"
>) {
  const isIframeFallbackOnTop = params.isIframeFallback && self === top;
  if (isIframeFallbackOnTop) {
    return;
  }

  cancelActiveDownload(params.videoId);
  const abortController = new AbortController();
  activeDownloads.set(params.videoId, abortController);

  emitCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    data: {
      videoId: params.videoId,
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: false
    }
  });
  void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadProgress, {
    videoId: params.videoId,
    progress: 0,
    progressType: ProgressType.Video
  });

  try {
    await resolveAndDispatch({
      params,
      abortSignal: abortController.signal
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    throw error;
  } finally {
    activeDownloads.delete(params.videoId);
  }
}
