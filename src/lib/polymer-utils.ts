import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import type { ButtonViewModelData } from "@/types";

export const PAPER_PROGRESS_THEME: Record<string, string> = {
  "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
  "--paper-progress-container-color": "transparent"
};

export const PAPER_INPUT_THEME: Record<string, string> = {
  "--paper-input-container-color": "var(--yt-spec-text-secondary, #aaa)",
  "--paper-input-container-focus-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
  "--paper-input-container-input-color": "var(--yt-spec-text-primary, #f1f1f1)"
};

export function applyPolymerCustomStyles(
  element: Element,
  styles: Record<string, string>
) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value);
  }
}

// The element must already have a data-ytdl-button-id attribute set.
export function sendButtonData(elButton: Element, data: ButtonViewModelData) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SetButtonData, {
    selector: `[data-ytdl-button-id="${elButton.getAttribute("data-ytdl-button-id")}"]`,
    data
  });
}
