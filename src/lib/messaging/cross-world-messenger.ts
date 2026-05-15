import { CrossWorldMessage, type PageMessengerSchema } from "./cross-world-schema";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

export { CrossWorldMessage } from "./cross-world-schema";
export type { PageMessengerSchema, StreamDataPayload } from "./cross-world-schema";

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });

// Multi-subscriber fanout for button clicks. The messenger's per-type
// single-listener constraint is bypassed by maintaining one module-level
// listener that distributes to every subscribed handler. Same-context
// dispatches are also delivered locally because the messenger filters out
// its own instanceId, otherwise a MAIN-world emitter wouldn't reach a
// MAIN-world subscriber.

const buttonClickHandlers = new Set<(buttonId: string) => void>();

function fanoutButtonClick(buttonId: string) {
  for (const handler of buttonClickHandlers) {
    handler(buttonId);
  }
}

crossWorldMessenger.onMessage(CrossWorldMessage.ButtonClick, ({ data }) => {
  fanoutButtonClick(data.buttonId);
});

export function dispatchButtonClick(buttonId: string) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.ButtonClick, { buttonId });
  fanoutButtonClick(buttonId);
}

export function onButtonClick(handler: (buttonId: string) => void) {
  buttonClickHandlers.add(handler);
  return () => {
    buttonClickHandlers.delete(handler);
  };
}
