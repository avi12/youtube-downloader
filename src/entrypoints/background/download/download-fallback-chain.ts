import { downloadViaCdn } from "./cdn-downloader";
import { attemptSabrDownload } from "./sabr-attempt";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { getCompatibleFilename } from "@/lib/utils/filename";
import { DownloadType, ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

type TrySabrParams = {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
};
export async function trySabr({ request, signal, tabId }: TrySabrParams) {
  try {
    return await attemptSabrDownload({
      request,
      signal,
      tabId
    });
  } catch (error) {
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
  }
}

type TryCdnParams = {
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  partialVideoData?: Uint8Array;
  partialAudioData?: Uint8Array;
};
export async function tryCdn({ request, signal, videoId, tabId, partialVideoData, partialAudioData }: TryCdnParams) {
  try {
    return await downloadViaCdn({
      request,
      signal,
      videoId,
      tabId,
      partialVideoData,
      partialAudioData
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:bg] CDN failed, trying iframe fallback:", error);
    return null;
  }
}

export async function tryDirectUrlDownload({ request }: {
  request: DownloadRequest;
}) {
  const { type, resolvedAudioUrl, filenameOutput } = request;
  const isAudioOnly = type === DownloadType.Audio;
  const cannotDirectDownload = !isAudioOnly || !resolvedAudioUrl;
  if (cannotDirectDownload) {
    return null;
  }

  try {
    const filename = getCompatibleFilename(filenameOutput);
    const downloadId = await browser.downloads.download({
      url: resolvedAudioUrl,
      filename
    });
    console.warn("[ytdl:bg] Direct URL download started, id:", downloadId);
    return downloadId;
  } catch (error) {
    console.warn("[ytdl:bg] Direct URL download failed:", error);
    return null;
  }
}
