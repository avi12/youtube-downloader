import { readStreamToBuffer, StreamStallError } from "@/lib/utils/stream";

const MAX_CDN_RETRY_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const FETCH_HEADER_TIMEOUT_MS = 30_000;
const HTTP_STATUS_RANGE_NOT_SATISFIABLE = 416;
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
type MergeUint8ArraysParams = {
  first: Uint8Array;
  second: Uint8Array;
};
function mergeUint8Arrays({ first, second }: MergeUint8ArraysParams) {
  const merged = new Uint8Array(first.byteLength + second.byteLength);
  merged.set(first, 0);
  merged.set(second, first.byteLength);
  return merged;
}

type AttemptFetchParams = {
  url: string;
  signal: AbortSignal;
  byteOffset: number;
};
async function attemptFetch({ url, signal, byteOffset }: AttemptFetchParams) {
  const headerTimeoutController = new AbortController();
  const timeoutId = setTimeout(() => headerTimeoutController.abort(), FETCH_HEADER_TIMEOUT_MS);
  function abortOnUserCancel() {
    headerTimeoutController.abort();
  }
  signal.addEventListener("abort", abortOnUserCancel, { once: true });

  try {
    const response = await fetch(url, {
      signal: headerTimeoutController.signal,
      credentials: "include",
      ...byteOffset > 0 && {
        headers: {
          Range: `bytes=${byteOffset}-`
        }
      }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortOnUserCancel);
    throw error;
  }
}

type FetchWithProgressParams = {
  url: string;
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
  initialData?: Uint8Array;
  onChunk?: (chunk: Uint8Array) => void;
};
export async function fetchWithProgress(
  { url, signal, onBytesReceived, initialData, onChunk }: FetchWithProgressParams
) {
  let partialData: Uint8Array | null = initialData ?? null;
  let byteOffset = initialData?.byteLength ?? 0;
  if (byteOffset > 0) {
    onBytesReceived(byteOffset);
  }

  let consecutiveRetries = 0;

  while (true) {
    const isLastAttempt = consecutiveRetries >= MAX_CDN_RETRY_ATTEMPTS;

    let response: Response | undefined;
    try {
      response = await attemptFetch({
        url,
        signal,
        byteOffset
      });
    } catch (fetchError) {
      if (signal.aborted) {
        throw fetchError;
      }

      if (isLastAttempt) {
        throw fetchError;
      }

      const delay = Math.min(RETRY_BASE_DELAY_MS * (2 ** consecutiveRetries), RETRY_MAX_DELAY_MS);
      console.warn(`[ytdl:bg] CDN fetch error at byte ${byteOffset}, retrying (${consecutiveRetries + 1}/${MAX_CDN_RETRY_ATTEMPTS})`, fetchError);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
      consecutiveRetries++;
      continue;
    }

    if (!response) {
      consecutiveRetries++;
      continue;
    }

    const isRangeNotSatisfiable = response.status === HTTP_STATUS_RANGE_NOT_SATISFIABLE;
    if (isRangeNotSatisfiable) {
      if (partialData?.byteLength) {
        return partialData;
      }

      throw new Error(`HTTP ${HTTP_STATUS_RANGE_NOT_SATISFIABLE} Range Not Satisfiable`);
    }

    const isResponseError = !response.ok;
    if (isResponseError) {
      const isRetryable = response.status >= 500
        || response.status === HTTP_STATUS_TOO_MANY_REQUESTS;
      const isUnrecoverable = !isRetryable || isLastAttempt;
      if (isUnrecoverable) {
        throw new Error(`HTTP ${response.status} fetching stream`);
      }

      const delay = Math.min(RETRY_BASE_DELAY_MS * (2 ** consecutiveRetries), RETRY_MAX_DELAY_MS);
      console.warn(`[ytdl:bg] CDN HTTP ${response.status} at byte ${byteOffset}, retrying (${consecutiveRetries + 1}/${MAX_CDN_RETRY_ATTEMPTS})`);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
      consecutiveRetries++;
      continue;
    }

    const isRangeRequestIgnored = byteOffset > 0 && response.status === HTTP_STATUS_OK;
    if (isRangeRequestIgnored) {
      if (onChunk) {
        return new Uint8Array(0);
      }

      onBytesReceived(-byteOffset);
      byteOffset = 0;
      partialData = null;
    }

    consecutiveRetries = 0;

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
          },
          onChunk
        });
      }

      return partialData ? mergeUint8Arrays({
        first: partialData,
        second: newData
      }) : newData;
    } catch (error) {
      const isStreamStall = error instanceof StreamStallError;
      const isStreamStallInStreamingMode = isStreamStall && !!onChunk;
      if (isStreamStallInStreamingMode) {
        return new Uint8Array(0);
      }

      const isRetryExhausted = consecutiveRetries >= MAX_CDN_RETRY_ATTEMPTS;
      const isUnrecoverableError = !isStreamStall || isRetryExhausted;
      if (isUnrecoverableError) {
        throw error;
      }

      partialData = partialData
        ? mergeUint8Arrays({
          first: partialData,
          second: error.partialData
        })
        : error.partialData;
      const delay = Math.min(RETRY_BASE_DELAY_MS * (2 ** consecutiveRetries), RETRY_MAX_DELAY_MS);
      console.warn(`[ytdl:bg] CDN stream interrupted at byte ${byteOffset}, retrying (${consecutiveRetries + 1}/${MAX_CDN_RETRY_ATTEMPTS})`);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
      consecutiveRetries++;
    }
  }
}
