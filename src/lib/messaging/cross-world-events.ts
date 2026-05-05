import type { ProgressUpdate } from "@/types";

const EVENT_NAME_PREFIX = "__ytdl_ce_";

export const CrossWorldEvent = {
  ProgressUpdate: "progressUpdate"
} as const;

type CrossWorldEvent = (typeof CrossWorldEvent)[keyof typeof CrossWorldEvent];

interface CrossWorldEventMap {
  [CrossWorldEvent.ProgressUpdate]: ProgressUpdate;
}

export function emitCrossWorldEvent<T extends CrossWorldEvent>({ type, data }: {
  type: T;
  data: CrossWorldEventMap[T];
}) {
  dispatchEvent(new CustomEvent(EVENT_NAME_PREFIX + type, { detail: JSON.stringify(data) }));
}

export function onCrossWorldEvent<T extends CrossWorldEvent>({ type, handler }: {
  type: T;
  handler: (data: CrossWorldEventMap[T]) => void;
}) {
  function listener(e: Event) {
    const detail = "detail" in e ? String(e.detail) : null;
    if (!detail) {
      return;
    }

    handler(JSON.parse(detail));
  }

  addEventListener(EVENT_NAME_PREFIX + type, listener);
  return () => removeEventListener(EVENT_NAME_PREFIX + type, listener);
}
