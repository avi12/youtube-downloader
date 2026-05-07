export const TRANSFER_CHUNK_SIZE = 1024 * 1024;

const BASE64_BATCH_SIZE = 8192;

export function uint8ToBase64(bytes: Uint8Array) {
  let binary = "";

  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_BATCH_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + BASE64_BATCH_SIZE, bytes.byteLength)));
  }

  return btoa(binary);
}
