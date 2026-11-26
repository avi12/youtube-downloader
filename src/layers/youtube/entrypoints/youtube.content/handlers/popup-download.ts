import { isButtonElement } from "@/lib/dom-guards";
import { MessageType, onMessage } from "@/lib/messaging/messaging";

const SELECTOR_WATCH_DOWNLOAD_BUTTON = ".ytdl-watch-group .ytdl-download-button button";

export function registerPopupDownloadHandler() {
  onMessage(MessageType.StartWatchPageDownload, () => {
    const elDownloadButton = document.querySelector(SELECTOR_WATCH_DOWNLOAD_BUTTON);
    const isClickable = isButtonElement(elDownloadButton) && !elDownloadButton.disabled;
    if (!isClickable) {
      return false;
    }

    elDownloadButton.click();
    return true;
  });
}
