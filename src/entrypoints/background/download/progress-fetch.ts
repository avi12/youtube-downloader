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
    const isOverrideUsed = fetchCount === 1 && firstBodyOverride !== undefined;
    const response = await fetch(input, {
      ...(init ?? {}),
      body: isOverrideUsed && firstBodyOverride != null ? firstBodyOverride.slice() : init?.body,
      signal,
      credentials: "include"
    });
    const contentType = response.headers.get("content-type");
    if (!response.ok && contentType === "application/vnd.yt-ump" && response.body) {
      return new Response(response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            onBytesReceived(chunk.byteLength);
            controller.enqueue(chunk);
          }
        })
      ), {
        status: 200,
        headers: response.headers
      });
    }

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
