const STREAM_STALL_TIMEOUT_MS = 30_000;
const STALL_CHECK_INTERVAL_MS = 1_000;

export class StreamStallError extends Error {
  constructor(public readonly partialData: Uint8Array) {
    super("Stream stalled");
    this.name = "StreamStallError";
  }
}

export function createStallChecker(onStall: () => void) {
  let lastActivityAt = Date.now();
  let isStalled = false;

  const timer = setInterval(() => {
    const isTimedOut = Date.now() - lastActivityAt > STREAM_STALL_TIMEOUT_MS;
    if (isTimedOut) {
      isStalled = true;
      onStall();
    }
  }, STALL_CHECK_INTERVAL_MS);

  return {
    touch() {
      lastActivityAt = Date.now();
    },
    get isStalled() {
      return isStalled;
    },
    clear() {
      clearInterval(timer);
    }
  };
}

export async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    return await reader.read();
  } catch (error) {
    const isAbortError = error instanceof DOMException && error.name === "AbortError";
    if (isAbortError) {
      throw error;
    }

    return null;
  }
}

export function mergeChunks({ chunks, totalBytes }: {
  chunks: Uint8Array[];
  totalBytes: number;
}) {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}
