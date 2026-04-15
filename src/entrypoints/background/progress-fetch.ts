import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { readStreamToBuffer } from "@/lib/utils/stream";
import { ProgressType } from "@/types";

const progressThrottleIntervalMs = 5000;
const lastProgressTimestamps = new Map<string, number>();

export async function sendProgressUpdate(
  videoId: string,
  progress: number,
  progressType: ProgressType,
  tabId: number
) {
  const isComplete = progress >= 1;
  if (!isComplete) {
    const now = Date.now();
    const lastSent = lastProgressTimestamps.get(videoId) ?? 0;
    if (now - lastSent < progressThrottleIntervalMs) {
      return;
    }

    lastProgressTimestamps.set(videoId, now);
  } else {
    lastProgressTimestamps.delete(videoId);
  }

  await sendMessage(MessageType.UpdateDownloadProgress, { videoId, progress, progressType }, tabId);
}

export function createProgressFetch(
  signal: AbortSignal,
  onBytesReceived: (bytes: number) => void
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, { ...init, signal, credentials: "include" });
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      onBytesReceived(buffer.byteLength);
      return new Response(buffer, { status: response.status, headers: response.headers });
    }

    const contentLength = parseInt(response.headers.get("Content-Length") ?? "0", 10);
    const data = await readStreamToBuffer(response.body.getReader(), contentLength, onBytesReceived);
    return new Response(data, { status: response.status, headers: response.headers });
  };
}

export async function fetchWithProgress(
  url: string,
  signal: AbortSignal,
  onBytesReceived: (bytes: number) => void
) {
  const response = await fetch(url, { signal, credentials: "include" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching stream`);
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onBytesReceived(buffer.byteLength);
    return new Uint8Array(buffer);
  }

  const contentLength = parseInt(response.headers.get("Content-Length") ?? "0", 10);
  return readStreamToBuffer(response.body.getReader(), contentLength, onBytesReceived);
}
