import type { YtFormattedStringElement } from "@/types/polymer-elements";

export function isYtFormattedString(elTarget: Element): elTarget is YtFormattedStringElement {
  return elTarget.tagName.toLowerCase() === "yt-formatted-string";
}

export function setFormattedStringText(elTarget: YtFormattedStringElement, textContent: string) {
  elTarget.text = { runs: [{ text: textContent }] };
}

export function attachFormattedString(text: string) {
  return (elTarget: Element) => {
    if (!isYtFormattedString(elTarget)) {
      return;
    }

    setFormattedStringText(elTarget, text);
  };
}
