import { MessageType, onMessage } from "@/lib/messaging/messaging";

const SELECTOR_WATCH_DOWNLOAD_BUTTON = ".ytdl-watch-group .ytdl-download-button button";

export function registerPopupDownloadHandler() {
  onMessage(MessageType.StartWatchPageDownload, () => {
    const elDownloadButton = document.querySelector<HTMLButtonElement>(SELECTOR_WATCH_DOWNLOAD_BUTTON);
    if (!elDownloadButton || elDownloadButton.disabled) {
      return false;
    }

    elDownloadButton.click();
    return true;
  });
}
