import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { StreamStallError, readStreamToBuffer } from "@/lib/utils/stream";
import { ProgressType } from "@/types";

const PROGRESS_THROTTLE_INTERVAL_MS = 5000;
const lastProgressTimestamps = new Map<string, number>();

const MAX_CDN_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const HTTP_STATUS_RANGE_NOT_SATISFIABLE = 416;
const HTTP_STATUS_OK = 200;

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

export async function fetchWithProgress({ url, signal, onBytesReceived }: {
  url: string;
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
}) {
  let partialData: Uint8Array | null = null;
  let byteOffset = 0;

  for (let attempt = 0; attempt <= MAX_CDN_RETRY_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      signal,
      credentials: "include",
      headers: byteOffset > 0 ? { Range: `bytes=${byteOffset}-` } : {}
    });
    if (response.status === HTTP_STATUS_RANGE_NOT_SATISFIABLE) {
      if (partialData) {
        return partialData;
      }

      throw new Error(`HTTP ${HTTP_STATUS_RANGE_NOT_SATISFIABLE} Range Not Satisfiable`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching stream`);
    }

    if (byteOffset > 0 && response.status === HTTP_STATUS_OK) {
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
      if (!(error instanceof StreamStallError) || attempt === MAX_CDN_RETRY_ATTEMPTS) {
        throw error;
      }

      partialData = partialData
        ? mergeUint8Arrays(partialData, error.partialData)
        : error.partialData;
      console.warn(`[ytdl:bg] CDN stream interrupted at byte ${byteOffset}, retrying (${attempt + 1}/${MAX_CDN_RETRY_ATTEMPTS})`);
      await new Promise<void>(resolve => setTimeout(resolve, RETRY_BASE_DELAY_MS * (2 ** attempt)));
    }
  }

  throw new Error("Max CDN retry attempts exceeded");
}
