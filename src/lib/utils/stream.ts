const STREAM_STALL_TIMEOUT_MS = 30_000;
const STALL_CHECK_INTERVAL_MS = 1_000;

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

  const preallocated = expectedBytes > 0 ? new Uint8Array(expectedBytes) : null;
  const chunks: Uint8Array[] = [];
  let writeOffset = 0;
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (isStalled) {
          throw new Error("Stream stalled");
        }

        break;
      }

      if (preallocated) {
        preallocated.set(value, writeOffset);
        writeOffset += value.byteLength;
      } else {
        chunks.push(value);
        totalBytes += value.byteLength;
      }

      lastActivityAt = Date.now();
      onBytesReceived?.(value.byteLength);
    }
  } finally {
    clearInterval(stallChecker);
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
