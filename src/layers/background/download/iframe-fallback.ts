import { IFRAME_AUTO_RETRIES, MAX_IFRAME_AUTO_RETRIES } from "./iframe-auto-retries";
import { downloadViaWatchPage } from "./iframe-downloader";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { createLogger, LogScope } from "@/lib/utils/logger";
import { ProgressType } from "@/types";
import type { DownloadRequest, Prettify, VideoTabParams } from "@/types";

const log = createLogger(LogScope.Background);

type HandleIframeFallbackParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
  videoId: string;
  onExhausted: (params: VideoTabParams) => void;
}>;
export async function handleIframeFallback({
  request, tabId, videoId, onExhausted
}: HandleIframeFallbackParams) {
  if (request.isIframeFallback) {
    const retries = IFRAME_AUTO_RETRIES.get(videoId) ?? 0;
    const isRetriesExhausted = retries >= MAX_IFRAME_AUTO_RETRIES;
    if (isRetriesExhausted) {
      IFRAME_AUTO_RETRIES.delete(videoId);
      log.warn("All download methods exhausted for", videoId);
      onExhausted({
        videoId,
        tabId
      });
      return;
    }

    IFRAME_AUTO_RETRIES.set(videoId, retries + 1);
    log.warn("Iframe fallback failed, auto-retrying via fresh iframe (attempt", retries + 1, ") for", videoId);
  } else {
    log.warn("SABR+CDN failed, trying offscreen iframe fallback for", videoId);
  }

  await sendMessageToTab({
 type: MessageType.UpdateDownloadProgress,
     data: {
    videoId,
    progress: 0,
    progressType: ProgressType.Video
  },
     tabId 
});

  await downloadViaWatchPage({
    data: {
      ...request,
      isIframeFallback: false
    },
    tabId
  });
}
