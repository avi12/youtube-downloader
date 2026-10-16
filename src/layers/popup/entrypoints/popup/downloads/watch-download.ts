import { MessageType, sendMessage, sendMessageToTab } from "@/lib/messaging/messaging";
import { isMobileWatchPageUrl } from "@/lib/youtube/youtube-url";
import type { DownloadRequest, Prettify } from "@/types";

type StartTabDownloadParams = Prettify<{
  tabId: number;
  sourceUrl: string;
  videoId: string;
  request?: DownloadRequest;
}>;
// The mobile site has no content script, so its download runs in the background's hidden watch page.
// A desktop tab runs it itself, the same way its own button or options panel would
export async function startTabDownload({ tabId, sourceUrl, videoId, request }: StartTabDownloadParams) {
  if (isMobileWatchPageUrl(sourceUrl)) {
    await sendMessage(MessageType.StartPopupDownload, {
      videoId,
      sourceUrl,
      request
    });
    return true;
  }

  if (request) {
    await sendMessageToTab(MessageType.ExecuteDownloadItem, request, tabId);
    return true;
  }

  return Boolean(await sendMessageToTab(MessageType.StartWatchPageDownload, undefined, tabId));
}
