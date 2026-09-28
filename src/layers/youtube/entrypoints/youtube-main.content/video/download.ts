import { resolveAndDispatch } from "./download-execute";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import type { DownloadRequest } from "@/types";

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
  "downloadExtras" | "includeAutoDubbing" |
  "playlistId" | "playlistTitle" | "playlistTotalCount" |
  "originTabId"
>) {
  const isIframeFallbackOnTop = params.isIframeFallback && self === top;
  if (isIframeFallbackOnTop) {
    return;
  }

  cancelActiveDownload(params.videoId);
  const abortController = new AbortController();
  activeDownloads.set(params.videoId, abortController);

  try {
    await resolveAndDispatch({
      params,
      abortSignal: abortController.signal
    });
  } catch (error) {
    const isAborted = abortController.signal.aborted;
    if (isAborted) {
      return;
    }

    console.warn("[ytdl:main] startDownload failed for", params.videoId, error);
    await crossWorldMessenger.sendMessage(
      CrossWorldMessage.ReportMainDownloadFailed,
      { videoId: params.videoId }
    );
  } finally {
    const isStillOwnController = activeDownloads.get(params.videoId) === abortController;
    if (isStillOwnController) {
      activeDownloads.delete(params.videoId);
    }
  }
}
