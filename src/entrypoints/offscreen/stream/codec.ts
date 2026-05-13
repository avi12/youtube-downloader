export function assembleStreamChunks({ chunks, totalChunks }: {
  chunks: Map<number, Uint8Array>;
  totalChunks: number;
}) {
  if (totalChunks === 0) {
    return null;
  }

  const totalBytes = chunks.values()
    .reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalBytes);
  let offset = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunks.get(i);
    if (!chunk) {
      continue;
    }

    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}
