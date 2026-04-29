import { cancelActiveDownload, performDownload } from "./video/download";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";

export function registerMainWorldHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    void performDownload(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    for (const videoId of data.videoIds) {
      cancelActiveDownload(videoId);
    }
  });

  const buttonIdByElement = new WeakMap<HTMLElement, string>();

  crossWorldMessenger.onMessage(CrossWorldMessage.SetButtonData, ({ data: { selector, data: buttonData } }) => {
    const elButton = document.querySelector<HTMLElement>(selector);
    if (!elButton || !("data" in elButton)) {
      return;
    }

    const buttonId = elButton.getAttribute("data-ytdl-button-id");
    if (buttonId) {
      buttonIdByElement.set(elButton, buttonId);
    }

    elButton.data = buttonData;

    if (elButton.hasAttribute("data-ytdl-click-bound")) {
      return;
    }

    elButton.setAttribute("data-ytdl-click-bound", "true");
    elButton.addEventListener("click", e => {
      const currentButtonId = buttonIdByElement.get(elButton);
      if (currentButtonId) {
        e.stopPropagation();
        dispatchButtonClick(currentButtonId);
      }
    });
  });
}
