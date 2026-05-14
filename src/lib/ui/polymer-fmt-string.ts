import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { YtFormattedStringElement } from "@/types/polymer-elements";

export const DATA_FORMATTED_STRING_ID_ATTR = "data-ytdl-fmtstr-id";
const DATA_FORMATTED_STRING_TEXT_ATTR = "data-ytdl-text";
let formattedStringIdCounter = 0;

export function isYtFormattedString(elTarget: Element): elTarget is YtFormattedStringElement {
  return elTarget.tagName.toLowerCase() === "yt-formatted-string";
}

export function setFormattedStringText(elTarget: YtFormattedStringElement, textContent: string) {
  elTarget.text = { runs: [{ text: textContent }] };
}

export function sendFormattedStringText(elTarget: Element, textContent: string) {
  const formattedStringId = elTarget.getAttribute(DATA_FORMATTED_STRING_ID_ATTR);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SetFormattedStringText, {
    selector: `[${DATA_FORMATTED_STRING_ID_ATTR}="${formattedStringId}"]`,
    text: textContent
  });
}

export function attachFormattedString(elTarget: Element) {
  elTarget.setAttribute(DATA_FORMATTED_STRING_ID_ATTR, `ytdl-fmt-${++formattedStringIdCounter}`);
  sendFormattedStringText(elTarget, elTarget.getAttribute(DATA_FORMATTED_STRING_TEXT_ATTR) ?? "");

  const observer = new MutationObserver(() => {
    sendFormattedStringText(elTarget, elTarget.getAttribute(DATA_FORMATTED_STRING_TEXT_ATTR) ?? "");
  });

  observer.observe(elTarget, { attributeFilter: [DATA_FORMATTED_STRING_TEXT_ATTR] });

  return () => observer.disconnect();
}
