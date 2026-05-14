import { downloadViaCdn } from "./cdn-downloader";
import { attemptSabrDownload } from "./sabr-attempt";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export async function trySabr(request: DownloadRequest, signal: AbortSignal, tabId: number) {
  return attemptSabrDownload({
    request,
    signal,
    tabId
  }).catch(error => {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:bg] SABR failed, trying CDN:", error);
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: request.videoId,
      progress: 0,
      progressType: ProgressType.Video
    }, tabId);
    return null;
  });
}

export async function tryCdn(
  request: DownloadRequest,
  signal: AbortSignal,
  videoId: string,
  tabId: number,
  partialVideoData?: Uint8Array,
  partialAudioData?: Uint8Array
) {
  return downloadViaCdn({
    request,
    signal,
    videoId,
    tabId,
    partialVideoData,
    partialAudioData
  }).catch(error => {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:bg] CDN failed, trying iframe fallback:", error);
    return null;
  });
}
