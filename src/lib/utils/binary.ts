export function uint8ToBase64(bytes: Uint8Array) {
  const batchSize = 8192;
  let binary = "";

  for (let offset = 0; offset < bytes.byteLength; offset += batchSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + batchSize, bytes.byteLength)));
  }

  return btoa(binary);
}
