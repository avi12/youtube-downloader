/**
 * Multi-subscriber fanout for one-way cross-world events. Funnels through
 * `crossWorldMessenger` but distributes to every subscribed handler so the
 * messenger's per-type single-listener constraint doesn't apply. Same-context
 * emissions are dispatched locally too because the messenger filters out its
 * own instanceId.
 */

import { CrossWorldMessage, crossWorldMessenger } from "./cross-world-messenger";
import type { ProgressUpdate } from "@/types";

export const CrossWorldEvent = {
  ProgressUpdate: "progressUpdate"
} as const;

const progressHandlers = new Set<(data: ProgressUpdate) => void>();

function fanoutProgress(data: ProgressUpdate) {
  for (const handler of progressHandlers) {
    handler(data);
  }
}

crossWorldMessenger.onMessage(CrossWorldMessage.ProgressUpdate, ({ data }) => {
  fanoutProgress(data);
});

export function emitCrossWorldEvent({ type, data }: {
  type: typeof CrossWorldEvent.ProgressUpdate;
  data: ProgressUpdate;
}) {
  void type;
  void crossWorldMessenger.sendMessage(CrossWorldMessage.ProgressUpdate, data);
  fanoutProgress(data);
}

export function onCrossWorldEvent({ type, handler }: {
  type: typeof CrossWorldEvent.ProgressUpdate;
  handler: (data: ProgressUpdate) => void;
}) {
  void type;
  progressHandlers.add(handler);
  return () => {
    progressHandlers.delete(handler);
  };
}
