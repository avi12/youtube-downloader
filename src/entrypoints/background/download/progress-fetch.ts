import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { StreamStallError, readStreamToBuffer } from "@/lib/utils/stream";
import { ProgressType } from "@/types";

const progressThrottleIntervalMs = 5000;
const lastProgressTimestamps = new Map<string, number>();

const maxCdnRetryAttempts = 3;
const retryBaseDelayMs = 1_000;

function mergeUint8Arrays(first: Uint8Array, second: Uint8Array) {
  const merged = new Uint8Array(first.byteLength + second.byteLength);
  merged.set(first, 0);
  merged.set(second, first.byteLength);
  return merged;
}

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
    if (now - lastSent < progressThrottleIntervalMs) {
      return;
    }

    lastProgressTimestamps.set(videoId, now);
  } else {
    lastProgressTimestamps.delete(videoId);
  }

  await sendMessage(MessageType.UpdateDownloadProgress, { videoId, progress, progressType }, tabId);
}

export function createProgressFetch({ signal, onBytesReceived }: {
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
}) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, { ...init, signal, credentials: "include" });
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      onBytesReceived(buffer.byteLength);
      return new Response(buffer, { status: response.status, headers: response.headers });
    }

    const contentLength = parseInt(response.headers.get("Content-Length") ?? "0", 10);
    const data = await readStreamToBuffer({
      reader: response.body.getReader(), expectedBytes: contentLength, onBytesReceived
    });
    return new Response(data, { status: response.status, headers: response.headers });
  };
}

export async function fetchWithProgress({ url, signal, onBytesReceived }: {
  url: string;
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
}) {
  let partialData: Uint8Array | null = null;
  let byteOffset = 0;

  for (let attempt = 0; attempt <= maxCdnRetryAttempts; attempt++) {
    const headers: HeadersInit = byteOffset > 0 ? { Range: `bytes=${byteOffset}-` } : {};
    const response = await fetch(url, { signal, credentials: "include", headers });
    if (response.status === 416) {
      if (partialData) {
        return partialData;
      }

      throw new Error("HTTP 416 Range Not Satisfiable");
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching stream`);
    }

    if (byteOffset > 0 && response.status === 200) {
      onBytesReceived(-byteOffset);
      byteOffset = 0;
      partialData = null;
    }

    try {
      let newData: Uint8Array;
      if (!response.body) {
        const buffer = await response.arrayBuffer();
        onBytesReceived(buffer.byteLength);
        byteOffset += buffer.byteLength;
        newData = new Uint8Array(buffer);
      } else {
        const contentLength = parseInt(response.headers.get("Content-Length") ?? "0", 10);
        newData = await readStreamToBuffer({
          reader: response.body.getReader(),
          expectedBytes: contentLength,
          onBytesReceived(bytes) {
            byteOffset += bytes;
            onBytesReceived(bytes);
          }
        });
      }

      return partialData ? mergeUint8Arrays(partialData, newData) : newData;
    } catch (error) {
      if (!(error instanceof StreamStallError) || attempt === maxCdnRetryAttempts) {
        throw error;
      }

      partialData = partialData
        ? mergeUint8Arrays(partialData, error.partialData)
        : error.partialData;
      console.warn(`[ytdl:bg] CDN stream interrupted at byte ${byteOffset}, retrying (${attempt + 1}/${maxCdnRetryAttempts})`);
      await new Promise<void>(resolve => setTimeout(resolve, retryBaseDelayMs * (2 ** attempt)));
    }
  }

  throw new Error("Max CDN retry attempts exceeded");
}
