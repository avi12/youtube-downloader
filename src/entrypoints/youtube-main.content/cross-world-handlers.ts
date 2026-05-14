import { registerButtonDataHandler } from "./button-data-handler";
import { cancelActiveDownload, performDownload } from "./video/download";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import {
  DATA_BUTTON_ID_ATTR,
  DATA_SETTINGS_OPTIONS_ID_ATTR,
  isYtFormattedString,
  isYtdSettingsOptionsRenderer,
  setFormattedStringText
} from "@/lib/ui/polymer-utils";
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
      const elViewButton = document.querySelector<HTMLElement>(`[${DATA_BUTTON_ID_ATTR}="${SNACKBAR_VIEW_BUTTON_ID}"]`);
      if (!elViewButton || !("data" in elViewButton)) {
        return;
      }

      elViewButton.data = {
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
        const elInner = elViewButton.querySelector("button");
        if (elInner) {
          elInner.classList.replace("ytSpecButtonShapeNextMono", "ytSpecButtonShapeNextCallToActionInverse");
        }
      });

      elViewButton.addEventListener("click", () => dispatchButtonClick(SNACKBAR_VIEW_BUTTON_ID));
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
    const elFormattedString = document.querySelector(selector);
    if (!elFormattedString || !isYtFormattedString(elFormattedString)) {
      return;
    }

    setFormattedStringText(elFormattedString, text);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.SetSettingsOptionsData, ({ data: { selector, title } }) => {
    const elPlaceholder = document.querySelector(selector);
    if (!elPlaceholder) {
      return;
    }

    const elRenderer = document.createElement("ytd-settings-options-renderer");
    const settingsId = elPlaceholder.getAttribute(DATA_SETTINGS_OPTIONS_ID_ATTR);
    if (settingsId) {
      elRenderer.setAttribute(DATA_SETTINGS_OPTIONS_ID_ATTR, settingsId);
    }

    for (const className of elPlaceholder.classList) {
      elRenderer.classList.add(className);
    }

    if (!isYtdSettingsOptionsRenderer(elRenderer)) {
      return;
    }

    elRenderer.set("data", {
      title: {
        runs: [{ text: title }]
      },
      options: []
    });
    elPlaceholder.parentNode?.insertBefore(elRenderer, elPlaceholder);

    const elOptions = elRenderer.querySelector("#options") ?? elRenderer;
    while (elPlaceholder.firstChild) {
      elOptions.appendChild(elPlaceholder.firstChild);
    }

    elPlaceholder.remove();
  });
}
