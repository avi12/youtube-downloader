import { StreamStallError, readStreamToBuffer } from "@/lib/utils/stream";

const MAX_CDN_RETRY_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const FETCH_HEADER_TIMEOUT_MS = 30_000;
const HTTP_STATUS_RANGE_NOT_SATISFIABLE = 416;
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
const RANGE_HEADER = "Range";
const CONTENT_LENGTH_HEADER = "Content-Length";

function mergeUint8Arrays({ first, second }: {
  first: Uint8Array;
  second: Uint8Array;
}) {
  const merged = new Uint8Array(first.byteLength + second.byteLength);
  merged.set(first, 0);
  merged.set(second, first.byteLength);
  return merged;
}

async function attemptFetch({ url, signal, byteOffset }: {
  url: string;
  signal: AbortSignal;
  byteOffset: number;
}) {
  // Timeout only guards against the server accepting the connection but not sending headers.
  // Once headers arrive we clear the timer so it never fires during the (potentially long) body read.
  // The user-cancel listener is kept so cancellation still aborts the body stream immediately.
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
          [RANGE_HEADER]: `bytes=${byteOffset}-`
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

export async function fetchWithProgress({ url, signal, onBytesReceived, initialData, onChunk }: {
  url: string;
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
  initialData?: Uint8Array;
  onChunk?: (chunk: Uint8Array) => void;
}) {
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
      if (!isRetryable || isLastAttempt) {
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
        // Streaming mode: data is already in OPFS. Re-reading from byte 0 would
        // corrupt the file. Accept what was streamed and let the mux handle it.
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
        const contentLength = parseInt(response.headers.get(CONTENT_LENGTH_HEADER) ?? "0", 10);
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
      // In streaming mode the chunks are already in OPFS - retrying from a byte
      // offset would send duplicate/overlapping data and corrupt the file.
      // Accept the partial stream and let the mux work with what it has.
      if (isStreamStall && onChunk) {
        return new Uint8Array(0);
      }

      const isUnrecoverableError = !isStreamStall || consecutiveRetries >= MAX_CDN_RETRY_ATTEMPTS;
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
