import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import type { YtFormattedStringElement } from "@/types/polymer-elements";

export const DATA_FMT_STRING_ID_ATTR = "data-ytdl-fmtstr-id";
const DATA_FMT_STRING_TEXT_ATTR = "data-ytdl-text";
let fmtStringIdCounter = 0;

export function isYtFormattedString(elTarget: Element): elTarget is YtFormattedStringElement {
  return elTarget.tagName.toLowerCase() === "yt-formatted-string";
}

export function setFormattedStringText(elTarget: YtFormattedStringElement, textContent: string) {
  elTarget.text = { runs: [{ text: textContent }] };
}

export function sendFormattedStringText(elTarget: Element, textContent: string) {
  const fmtStringId = elTarget.getAttribute(DATA_FMT_STRING_ID_ATTR);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.SetFormattedStringText, {
    selector: `[${DATA_FMT_STRING_ID_ATTR}="${fmtStringId}"]`,
    text: textContent
  });
}

export function attachFmtStr(elTarget: Element) {
  elTarget.setAttribute(DATA_FMT_STRING_ID_ATTR, `ytdl-fmt-${++fmtStringIdCounter}`);
  sendFormattedStringText(elTarget, elTarget.getAttribute(DATA_FMT_STRING_TEXT_ATTR) ?? "");

  const observer = new MutationObserver(() => {
    sendFormattedStringText(elTarget, elTarget.getAttribute(DATA_FMT_STRING_TEXT_ATTR) ?? "");
  });

  observer.observe(elTarget, { attributeFilter: [DATA_FMT_STRING_TEXT_ATTR] });

  return () => observer.disconnect();
}
