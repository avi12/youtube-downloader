import { type PageMessengerSchema } from "./cross-world-schema";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

export { CrossWorldMessage } from "./cross-world-schema";
export type { PageMessengerSchema, StreamDataPayload } from "./cross-world-schema";

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });

const BUTTON_CLICK_EVENT_NAME = "ytdl-btn-click";

function isButtonClickEvent(e: Event): e is CustomEvent<{ buttonId: string }> {
  return e instanceof CustomEvent && typeof e.detail?.buttonId === "string";
}

export function dispatchButtonClick(buttonId: string) {
  dispatchEvent(
    new CustomEvent<{ buttonId: string }>(BUTTON_CLICK_EVENT_NAME, {
      detail: {
        buttonId
      }
    })
  );
}

export function onButtonClick(handler: (buttonId: string) => void) {
  function listener(e: Event) {
    if (isButtonClickEvent(e)) {
      handler(e.detail.buttonId);
    }
  }

  addEventListener(BUTTON_CLICK_EVENT_NAME, listener);
  return () => removeEventListener(BUTTON_CLICK_EVENT_NAME, listener);
}
