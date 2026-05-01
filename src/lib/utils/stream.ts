const STREAM_STALL_TIMEOUT_MS = 30_000;
const STALL_CHECK_INTERVAL_MS = 1_000;

export class StreamStallError extends Error {
  constructor(public readonly partialData: Uint8Array, public readonly underlyingError?: string) {
    super(underlyingError ? `Stream stalled (${underlyingError})` : "Stream stalled");
    this.name = "StreamStallError";
  }
}

function buildPartialData(
  preallocated: Uint8Array | null,
  chunks: Uint8Array[],
  totalBytes: number,
  writeOffset: number
) {
  if (preallocated) {
    return preallocated.subarray(0, writeOffset);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    const chunk = await reader.read();
    return {
      chunk,
      error: null
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {
      chunk: null,
      error: detail
    };
  }
}

export async function readStreamToBuffer({ reader, expectedBytes, onBytesReceived }: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  expectedBytes: number;
  onBytesReceived?: (bytes: number) => void;
}) {
  let lastActivityAt = Date.now();
  let isStalled = false;
  const stallChecker = setInterval(() => {
    if (Date.now() - lastActivityAt > STREAM_STALL_TIMEOUT_MS) {
      isStalled = true;
      void reader.cancel();
    }
  }, STALL_CHECK_INTERVAL_MS);

  let preallocated: Uint8Array | null = null;
  if (expectedBytes > 0) {
    try {
      preallocated = new Uint8Array(expectedBytes);
    } catch {
      // OOM for large files - fall through to chunked accumulation
    }
  }

  const chunks: Uint8Array[] = [];
  let writeOffset = 0;
  let totalBytes = 0;

  let lastReadError: string | undefined = undefined;
  try {
    while (true) {
      const result = await readChunk(reader);
      if (result.error) {
        lastReadError = result.error;
      }

      if (!result.chunk) {
        if (!isStalled) {
          throw new StreamStallError(buildPartialData(preallocated, chunks, totalBytes, writeOffset), lastReadError);
        }

        break;
      }

      const { done, value } = result.chunk;
      if (done) {
        break;
      }

      if (preallocated) {
        preallocated.set(value!, writeOffset);
        writeOffset += value!.byteLength;
      } else {
        chunks.push(value!);
        totalBytes += value!.byteLength;
      }

      lastActivityAt = Date.now();
      onBytesReceived?.(value!.byteLength);
    }
  } finally {
    clearInterval(stallChecker);
  }

  if (isStalled) {
    throw new StreamStallError(buildPartialData(preallocated, chunks, totalBytes, writeOffset), lastReadError);
  }

  if (preallocated) {
    return preallocated;
  }

  const result = new Uint8Array(totalBytes);
  let mergeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, mergeOffset);
    mergeOffset += chunk.byteLength;
  }
  return result;
}
