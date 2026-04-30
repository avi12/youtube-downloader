import { CrossWorldMessage } from "./cross-world-messages";
import type { PageMessengerSchema } from "./cross-world-schema";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

export { CrossWorldMessage };
export type { PageMessengerSchema };

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });

export type StreamDataPayload = Parameters<PageMessengerSchema[typeof CrossWorldMessage.StreamData]>[0];

const buttonClickEventName = "ytdl-btn-click";

function isButtonClickEvent(e: Event): e is CustomEvent<{ buttonId: string }> {
  return e instanceof CustomEvent && typeof e.detail?.buttonId === "string";
}

export function dispatchButtonClick(buttonId: string) {
  dispatchEvent(new CustomEvent<{ buttonId: string }>(buttonClickEventName, { detail: { buttonId } }));
}

export function onButtonClick(handler: (buttonId: string) => void) {
  function listener(e: Event) {
    if (isButtonClickEvent(e)) {
      handler(e.detail.buttonId);
    }
  }

  addEventListener(buttonClickEventName, listener);
  return () => removeEventListener(buttonClickEventName, listener);
}
