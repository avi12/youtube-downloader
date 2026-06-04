import { registerButtonDataHandler } from "./button-data-handler";
import "./cta-button.css";
import { cancelActiveDownload, startDownload } from "./video/download";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import {
  DATA_BUTTON_ID_ATTR,
  DATA_SETTINGS_OPTIONS_ID_ATTR,
  isYtdSettingsOptionsRenderer
} from "@/lib/ui/polymer-utils";
import { isYtButtonViewModelElement } from "@/lib/youtube/schemas";
import { ButtonSize, ButtonState, ButtonStyle, ButtonType } from "@/types";

const SNACKBAR_VIEW_BUTTON_ID = "ytdl-snackbar-view";
const SETTINGS_OPTIONS_RENDERER_TAG = "ytd-settings-options-renderer";
const SETTINGS_OPTIONS_ID_SELECTOR = "#options";

export function registerCrossWorldHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    void startDownload(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.OpenSnackbar, () => {
    requestAnimationFrame(() => {
      const elViewButton = document.querySelector(`[${DATA_BUTTON_ID_ATTR}="${SNACKBAR_VIEW_BUTTON_ID}"]`);
      if (!isYtButtonViewModelElement(elViewButton)) {
        return;
      }

      elViewButton.data = {
        title: "View",
        accessibilityText: "View in folder",
        style: ButtonStyle.Mono,
        type: ButtonType.Text,
        buttonSize: ButtonSize.XSmall,
        state: ButtonState.Active,
        isFullWidth: false,
        isDisabled: false,
        tooltip: ""
      };

      elViewButton.addEventListener("click", () => dispatchButtonClick(SNACKBAR_VIEW_BUTTON_ID));
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    for (const videoId of data.videoIds) {
      cancelActiveDownload(videoId);
    }
  });

  registerButtonDataHandler();

  crossWorldMessenger.onMessage(CrossWorldMessage.SetSettingsOptionsData, ({ data: { selector, title } }) => {
    const elPlaceholder = document.querySelector(selector);
    if (!elPlaceholder) {
      return;
    }

    const elRenderer = document.createElement(SETTINGS_OPTIONS_RENDERER_TAG);
    const settingsId = elPlaceholder.getAttribute(DATA_SETTINGS_OPTIONS_ID_ATTR);
    if (settingsId) {
      elRenderer.setAttribute(DATA_SETTINGS_OPTIONS_ID_ATTR, settingsId);
    }

    for (const className of elPlaceholder.classList) {
      elRenderer.classList.add(className);
    }

    const isValidSettingsRenderer = isYtdSettingsOptionsRenderer(elRenderer);
    if (!isValidSettingsRenderer) {
      return;
    }

    elRenderer.set("data", {
      title: {
        runs: [{ text: title }]
      },
      options: []
    });
    elPlaceholder.parentNode?.insertBefore(elRenderer, elPlaceholder);

    const elOptions = elRenderer.querySelector(SETTINGS_OPTIONS_ID_SELECTOR) ?? elRenderer;
    while (elPlaceholder.firstChild) {
      elOptions.append(elPlaceholder.firstChild);
    }

    elPlaceholder.remove();
  });
}
