import { registerButtonDataHandler } from "./button-data-handler";
import { cancelActiveDownload, performDownload } from "./video/download";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import { DATA_BUTTON_ID_ATTR, isYtFormattedString, setFormattedStringText } from "@/lib/ui/polymer-utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  ProgressType
} from "@/types";

const SNACKBAR_VIEW_BUTTON_ID = "ytdl-snackbar-view";

export function registerCrossWorldHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    void performDownload(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.OpenSnackbar, () => {
    requestAnimationFrame(() => {
      const elViewBtn = document.querySelector<HTMLElement>(`[${DATA_BUTTON_ID_ATTR}="${SNACKBAR_VIEW_BUTTON_ID}"]`);
      if (!elViewBtn || !("data" in elViewBtn)) {
        return;
      }

      elViewBtn.data = {
        title: "View",
        accessibilityText: "View in folder",
        style: ButtonStyle.CallToAction,
        type: ButtonType.Text,
        buttonSize: ButtonSize.XSmall,
        state: ButtonState.Active,
        isFullWidth: false,
        isDisabled: false,
        tooltip: ""
      };

      queueMicrotask(() => {
        const elInner = elViewBtn.querySelector("button");
        if (elInner) {
          elInner.classList.replace("ytSpecButtonShapeNextMono", "ytSpecButtonShapeNextCallToActionInverse");
        }
      });

      elViewBtn.addEventListener("click", () => dispatchButtonClick(SNACKBAR_VIEW_BUTTON_ID));
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    for (const videoId of data.videoIds) {
      cancelActiveDownload(videoId);
      emitCrossWorldEvent({
        type: CrossWorldEvent.ProgressUpdate,
        data: {
          videoId,
          progress: 0,
          progressType: ProgressType.Video,
          isRemoved: true
        }
      });
    }
  });

  registerButtonDataHandler();

  crossWorldMessenger.onMessage(CrossWorldMessage.SetFormattedStringText, ({ data: { selector, text } }) => {
    const elFmtStr = document.querySelector(selector);
    if (!elFmtStr || !isYtFormattedString(elFmtStr)) {
      return;
    }

    setFormattedStringText(elFmtStr, text);
  });
}
