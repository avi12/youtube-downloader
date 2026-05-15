import { createStallChecker, mergeChunks, readChunk, StreamStallError } from "./stream-stall";

export { StreamStallError } from "./stream-stall";

export async function readStreamToBuffer({ reader, expectedBytes, onBytesReceived }: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  expectedBytes: number;
  onBytesReceived?: (bytes: number) => void;
}) {
  const stall = createStallChecker(() => void reader.cancel());

  let preallocated: Uint8Array | null = null;
  const hasExpectedBytes = expectedBytes > 0;
  if (hasExpectedBytes) {
    try {
      preallocated = new Uint8Array(expectedBytes);
    } catch {
      // OOM for large files - fall through to chunked accumulation
    }
  }

  const chunks: Uint8Array[] = [];
  let writeOffset = 0;
  let totalBytes = 0;

  function buildPartial() {
    return preallocated
      ? preallocated.subarray(0, writeOffset)
      : mergeChunks({
        chunks,
        totalBytes
      });
  }

  try {
    while (true) {
      const chunk = await readChunk(reader);
      if (!chunk) {
        if (!stall.isStalled) {
          throw new StreamStallError(buildPartial());
        }

        break;
      }

      const { done, value } = chunk;
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

      stall.touch();
      onBytesReceived?.(value!.byteLength);
    }
  } finally {
    stall.clear();
  }

  if (stall.isStalled) {
    throw new StreamStallError(buildPartial());
  }

  return preallocated ?? mergeChunks({
    chunks,
    totalBytes
  });
}
