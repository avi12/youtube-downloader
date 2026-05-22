import { MessageType, sendMessage, sendMessageToTab } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";

function isServiceWorker() {
  return typeof document === "undefined";
}

export { fetchWithProgress } from "./cdn-fetch";

const PROGRESS_THROTTLE_INTERVAL_MS = 1000;
const lastProgressTimestamps = new Map<string, number>();

type SendProgressUpdateParams = {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  tabId: number;
};
export async function sendProgressUpdate({ videoId, progress, progressType, tabId }: SendProgressUpdateParams) {
  const isComplete = progress >= 1;
  if (isComplete) {
    lastProgressTimestamps.delete(videoId);
  } else {
    const now = Date.now();
    const lastSent = lastProgressTimestamps.get(videoId) ?? 0;
    const isTooSoon = now - lastSent < PROGRESS_THROTTLE_INTERVAL_MS;
    if (isTooSoon) {
      return;
    }

    lastProgressTimestamps.set(videoId, now);
  }

  const isWorker = isServiceWorker();
  if (isWorker) {
    await sendMessageToTab(MessageType.UpdateDownloadProgress, {
      videoId,
      progress,
      progressType
    }, tabId);
  } else {
    await sendMessage(MessageType.ForwardProgressUpdate, {
      videoId,
      progress,
      progressType,
      tabId
    });
  }
}

type CreateProgressFetchParams = {
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
};
export function createProgressFetch({ signal, onBytesReceived }: CreateProgressFetchParams) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, {
      ...init,
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
