/**
 * Lightweight fire-and-forget cross-world event bus using CustomEvent.
 *
 * Unlike crossWorldMessenger (which uses defineCustomEventMessaging and blocks
 * on a synchronous request/response round-trip), this emitter dispatches a
 * one-way CustomEvent that never waits for a reply.  This makes it safe for
 * high-frequency or completion signals that would otherwise freeze YouTube's
 * heavy watch page.
 */

import type { ProgressUpdate } from "@/types";

const EVENT_PREFIX = "ytdl-event";

export const CrossWorldEvent = {
  ProgressUpdate: "progressUpdate"
} as const;

type CrossWorldEvent = (typeof CrossWorldEvent)[keyof typeof CrossWorldEvent];

interface CrossWorldEventMap {
  [CrossWorldEvent.ProgressUpdate]: ProgressUpdate;
}

export function emitCrossWorldEvent<T extends CrossWorldEvent>(
  type: T,
  data: CrossWorldEventMap[T]
) {
  dispatchEvent(new CustomEvent(`${EVENT_PREFIX}:${type}`, { detail: data }));
}

export function onCrossWorldEvent<T extends CrossWorldEvent>(
  type: T,
  handler: (data: CrossWorldEventMap[T]) => void
) {
  const eventName = `${EVENT_PREFIX}:${type}`;
  function listener(e: Event) {
    if (e instanceof CustomEvent) {
      handler(e.detail);
    }
  }

  addEventListener(eventName, listener);
  return () => removeEventListener(eventName, listener);
}
