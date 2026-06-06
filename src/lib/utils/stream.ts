import { createStallChecker, mergeChunks, readChunk, StreamStallError } from "./stream-stall";

export { StreamStallError } from "./stream-stall";

export async function readStreamToBuffer({ reader, expectedBytes, onBytesReceived, onChunk }: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  expectedBytes: number;
  onBytesReceived?: (bytes: number) => void;
  onChunk?: (chunk: Uint8Array) => void;
}) {
  const stall = createStallChecker(() => {
    reader.cancel().catch(() => {});
  });

  const isStreamingMode = !!onChunk;
  let preallocated: Uint8Array | null = null;
  const hasExpectedBytes = expectedBytes > 0;
  const canPreallocate = hasExpectedBytes && !isStreamingMode;
  if (canPreallocate) {
    try {
      preallocated = new Uint8Array(expectedBytes);
    } catch { /* OOM fallback */ }
  }

  const chunks: Uint8Array[] = [];
  let writeOffset = 0;
  let totalBytes = 0;

  function buildPartial() {
    if (isStreamingMode) {
      return new Uint8Array(0);
    }

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
      const isChunkMissing = !chunk;
      if (isChunkMissing) {
        const isUnexpectedEnd = !stall.isStalled;
        if (isUnexpectedEnd) {
          throw new StreamStallError(buildPartial());
        }

        break;
      }

      const { done, value } = chunk;
      if (done) {
        break;
      }

      if (isStreamingMode) {
        onChunk!(value!);
        totalBytes += value!.byteLength;
      } else if (preallocated) {
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

  const isStreamStalled = stall.isStalled;
  if (isStreamStalled) {
    throw new StreamStallError(buildPartial());
  }

  const isBelowExpected = totalBytes < expectedBytes;
  const isShortRead = !isStreamingMode && hasExpectedBytes && isBelowExpected;
  if (isShortRead) {
    throw new StreamStallError(buildPartial());
  }

  if (isStreamingMode) {
    return new Uint8Array(0);
  }

  return preallocated ?? mergeChunks({
    chunks,
    totalBytes
  });
}
