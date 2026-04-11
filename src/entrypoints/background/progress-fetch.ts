import { MessageType, sendMessage } from "@/lib/messaging";
import { statusProgressItem } from "@/lib/storage";
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

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(value);
      totalBytes += value.byteLength;
      onBytesReceived(value.byteLength);
    }

    const result = new Uint8Array(totalBytes);
    let writeOffset = 0;
    for (const chunk of chunks) {
      result.set(chunk, writeOffset);
      writeOffset += chunk.byteLength;
    }

    return new Response(result, { status: response.status, headers: response.headers });
  };
}

const STREAM_STALL_TIMEOUT_MS = 30_000;

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

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const readResult = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Stream stalled")), STREAM_STALL_TIMEOUT_MS))
    ]);    if (readResult.done) {
      break;
    }

    chunks.push(readResult.value);
    receivedBytes += readResult.value.byteLength;
    onBytesReceived(readResult.value.byteLength);
  }

  const result = new Uint8Array(receivedBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return result;
}
