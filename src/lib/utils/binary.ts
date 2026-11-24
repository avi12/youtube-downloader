export const TRANSFER_CHUNK_SIZE = 1024 * 1024;

const IS_NATIVE_BASE64_SUPPORTED = "toBase64" in Uint8Array.prototype && "fromBase64" in Uint8Array;

export function base64ToUint8Array(base64: string) {
  if (IS_NATIVE_BASE64_SUPPORTED) {
    return Uint8Array.fromBase64(base64);
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const BASE64_BATCH_SIZE = 8192;

export function uint8ToBase64(bytes: Uint8Array) {
  if (IS_NATIVE_BASE64_SUPPORTED) {
    return bytes.toBase64();
  }

  let binary = "";

  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_BATCH_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + BASE64_BATCH_SIZE, bytes.byteLength)));
  }

  return btoa(binary);
}
