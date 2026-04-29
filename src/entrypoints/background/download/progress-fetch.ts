import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";

export { fetchWithProgress } from "./cdn-fetch";

const PROGRESS_THROTTLE_INTERVAL_MS = 5000;
const lastProgressTimestamps = new Map<string, number>();

export async function sendProgressUpdate({ videoId, progress, progressType, tabId }: {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  tabId: number;
}) {
  const isComplete = progress >= 1;
  if (!isComplete) {
    const now = Date.now();
    const lastSent = lastProgressTimestamps.get(videoId) ?? 0;
    if (now - lastSent < PROGRESS_THROTTLE_INTERVAL_MS) {
      return;
    }

    lastProgressTimestamps.set(videoId, now);
  } else {
    lastProgressTimestamps.delete(videoId);
  }

  await sendMessage(MessageType.UpdateDownloadProgress, {
    videoId,
    progress,
    progressType
  }, tabId);
}

export function createProgressFetch({ signal, onBytesReceived, firstBodyOverride }: {
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
  firstBodyOverride?: Uint8Array;
}) {
  let fetchCount = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount++;
    const useOverride = fetchCount === 1 && firstBodyOverride !== undefined;
    const effectiveInit: RequestInit = useOverride
      ? { ...init, body: firstBodyOverride as BodyInit }
      : (init ?? {});

    const response = await fetch(input, {
      ...effectiveInit,
      signal,
      credentials: "include"
    });
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      onBytesReceived(buffer.byteLength);
      return new Response(buffer, {
        status: response.status,
        headers: response.headers
      });
    }

    const progressStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onBytesReceived(chunk.byteLength);
        controller.enqueue(chunk);
      }
    });

    return new Response(response.body.pipeThrough(progressStream), {
      status: response.status,
      headers: response.headers
    });
  };
}
