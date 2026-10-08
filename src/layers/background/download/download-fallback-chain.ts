import { downloadViaCdn } from "./cdn-downloader";
import { attemptSabrDownload } from "./sabr-attempt";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { getCompatibleFilename } from "@/lib/utils/filename";
import { createLogger, LogScope } from "@/lib/utils/logger";
import { DownloadType, ProgressType } from "@/types";
import type { DownloadRequest, Prettify } from "@/types";

const log = createLogger(LogScope.Background);

type TrySabrParams = Prettify<{
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}>;
export async function trySabr({ request, signal, tabId }: TrySabrParams) {
  try {
    return attemptSabrDownload({
      request,
      signal,
      tabId
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    log.warn("SABR failed, trying CDN:", error);
    await sendMessageToTab(MessageType.UpdateDownloadProgress, {
      videoId: request.videoId,
      progress: 0,
      progressType: ProgressType.Video
    }, tabId);
    return null;
  }
}

type TryCdnParams = Prettify<{
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  partialVideoData?: Uint8Array;
  partialAudioData?: Uint8Array;
}>;
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

    log.warn("CDN failed, trying iframe fallback:", error);
    return null;
  }
}

export async function tryDirectUrlDownload({ request }: {
  request: DownloadRequest;
}) {
  const { type, resolvedAudioUrl, filenameOutput } = request;
  const isAudioOnly = type === DownloadType.Audio;
  const canDirectDownload = isAudioOnly && !!resolvedAudioUrl;
  if (!canDirectDownload) {
    return null;
  }

  try {
    const filename = getCompatibleFilename(filenameOutput);
    const downloadId = await browser.downloads.download({
      url: resolvedAudioUrl,
      filename
    });
    log.warn("Direct URL download started, id:", downloadId);
    return downloadId;
  } catch (error) {
    log.warn("Direct URL download failed:", error);
    return null;
  }
}
