import { StreamStallError, readStreamToBuffer } from "@/lib/utils/stream";

const MAX_CDN_RETRY_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const HTTP_STATUS_RANGE_NOT_SATISFIABLE = 416;
const HTTP_STATUS_OK = 200;

function mergeUint8Arrays(first: Uint8Array, second: Uint8Array) {
  const merged = new Uint8Array(first.byteLength + second.byteLength);
  merged.set(first, 0);
  merged.set(second, first.byteLength);
  return merged;
}

export async function fetchWithProgress({ url, signal, onBytesReceived, initialData }: {
  url: string;
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
  initialData?: Uint8Array;
}) {
  let partialData: Uint8Array | null = initialData ?? null;
  let byteOffset = initialData?.byteLength ?? 0;
  if (byteOffset > 0) {
    onBytesReceived(byteOffset);
  }

  for (let attempt = 0; attempt <= MAX_CDN_RETRY_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      signal,
      credentials: "include",
      ...byteOffset > 0 && {
        headers: {
          Range: `bytes=${byteOffset}-`
        }
      }
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

    const isRangeRequestIgnored = byteOffset > 0 && response.status === HTTP_STATUS_OK;
    if (isRangeRequestIgnored) {
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
      const isUnrecoverableError = !(error instanceof StreamStallError) || attempt === MAX_CDN_RETRY_ATTEMPTS;
      if (isUnrecoverableError) {
        throw error;
      }

      partialData = partialData
        ? mergeUint8Arrays(partialData, error.partialData)
        : error.partialData;
      const delay = Math.min(RETRY_BASE_DELAY_MS * (2 ** attempt), RETRY_MAX_DELAY_MS);
      console.warn(`[ytdl:bg] CDN stream interrupted at byte ${byteOffset}, retrying (${attempt + 1}/${MAX_CDN_RETRY_ATTEMPTS})`);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error("Max CDN retry attempts exceeded");
}
