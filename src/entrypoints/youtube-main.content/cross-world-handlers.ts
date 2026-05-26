import { registerButtonDataHandler } from "./button-data-handler";
import ctaButtonStyles from "./cta-button.css?inline";
import { cancelActiveDownload, startDownload } from "./video/download";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import {
  DATA_BUTTON_ID_ATTR,
  DATA_SETTINGS_OPTIONS_ID_ATTR,
  isYtdSettingsOptionsRenderer
} from "@/lib/ui/polymer-utils";
import { ButtonSize, ButtonState, ButtonStyle, ButtonType } from "@/types";

const SNACKBAR_VIEW_BUTTON_ID = "ytdl-snackbar-view";
const CTA_STYLES_ELEMENT_ID = "ytdl-cta-styles";
const SETTINGS_OPTIONS_RENDERER_TAG = "ytd-settings-options-renderer";
const SETTINGS_OPTIONS_ID_SELECTOR = "#options";

function injectCtaButtonStyles() {
  const isCtaStylesAlreadyInjected = !!document.getElementById(CTA_STYLES_ELEMENT_ID);
  if (isCtaStylesAlreadyInjected) {
    return;
  }

  const elStyle = document.createElement("style");
  elStyle.id = CTA_STYLES_ELEMENT_ID;
  elStyle.textContent = ctaButtonStyles;
  document.head.append(elStyle);
}

export function registerCrossWorldHandlers() {
  injectCtaButtonStyles();
  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    void startDownload(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.OpenSnackbar, () => {
    requestAnimationFrame(() => {
      const elViewButton = document.querySelector<HTMLElement>(`[${DATA_BUTTON_ID_ATTR}="${SNACKBAR_VIEW_BUTTON_ID}"]`);
      const isViewButtonUnavailable = !elViewButton || !("data" in elViewButton);
      if (isViewButtonUnavailable) {
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
