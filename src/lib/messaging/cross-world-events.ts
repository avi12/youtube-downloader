/**
 * Lightweight fire-and-forget cross-world event bus using postMessage.
 * One-way, no response. Use crossWorldMessenger for request/response patterns.
 */

import type { ProgressUpdate } from "@/types";

const EVENT_TYPE_KEY = "__ytdl_event";
const EVENT_ORIGIN = location.origin;

export const CrossWorldEvent = {
  ProgressUpdate: "progressUpdate"
} as const;

type CrossWorldEvent = (typeof CrossWorldEvent)[keyof typeof CrossWorldEvent];

interface CrossWorldEventMap {
  [CrossWorldEvent.ProgressUpdate]: ProgressUpdate;
}

interface CrossWorldEventEnvelope<T extends CrossWorldEvent> {
  [EVENT_TYPE_KEY]: T;
  data: CrossWorldEventMap[T];
}

function hasEventTypeKey(value: unknown): value is { [EVENT_TYPE_KEY]: unknown } {
  return typeof value === "object" && value !== null && EVENT_TYPE_KEY in value;
}

function isCrossWorldEnvelope<T extends CrossWorldEvent>(
  value: unknown,
  type: T
): value is CrossWorldEventEnvelope<T> {
  return hasEventTypeKey(value) && value[EVENT_TYPE_KEY] === type;
}

export function emitCrossWorldEvent<T extends CrossWorldEvent>({ type, data }: {
  type: T;
  data: CrossWorldEventMap[T];
}) {
  window.postMessage({
    [EVENT_TYPE_KEY]: type,
    data
  }, EVENT_ORIGIN);
}

export function onCrossWorldEvent<T extends CrossWorldEvent>({ type, handler }: {
  type: T;
  handler: (data: CrossWorldEventMap[T]) => void;
}) {
  function listener(e: MessageEvent) {
    if (!isCrossWorldEnvelope(e.data, type)) {
      return;
    }

    handler(e.data.data);
  }

  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
