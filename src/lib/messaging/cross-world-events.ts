/**
 * Lightweight fire-and-forget cross-world event bus using postMessage.
 *
 * postMessage serializes data via structured clone, making it safe to pass
 * between MAIN world and isolated world in Firefox (no Xray realm issues).
 * Unlike crossWorldMessenger, this is one-way with no response.
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

function hasEventTypeKey(value: object): value is { [EVENT_TYPE_KEY]: unknown } {
  return EVENT_TYPE_KEY in value;
}

function isCrossWorldEnvelope<T extends CrossWorldEvent>(
  value: unknown,
  type: T
): value is CrossWorldEventEnvelope<T> {
  return (
    typeof value === "object"
    && value !== null
    && hasEventTypeKey(value)
    && value[EVENT_TYPE_KEY] === type
  );
}

export function emitCrossWorldEvent<T extends CrossWorldEvent>({ type, data }: {
  type: T;
  data: CrossWorldEventMap[T];
}) {
  postMessage({
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

  addEventListener("message", listener);
  return () => removeEventListener("message", listener);
}
