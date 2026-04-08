import { decryptSignatureCipher } from "@/lib/signature-decryptor";
import { type AdaptiveFormatItem } from "@/types";

export async function fetchStreamFromUrl(
  url: string,
  onProgress: (receivedBytes: number, totalBytes: number) => void,
  fetchSignal?: AbortSignal
) {
  const response = await fetch(url, { signal: fetchSignal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching stream`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress(buffer.byteLength, buffer.byteLength);
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    receivedBytes += value.byteLength;
    onProgress(receivedBytes, contentLength);
  }

  const result = new Uint8Array(receivedBytes);
  let writeOffset = 0;

  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return result;
}

export async function resolveFormatUrl(format: AdaptiveFormatItem | null) {
  if (!format) {
    return null;
  }

  if (format.url) {
    return format.url;
  }

  if (format.signatureCipher) {
    return decryptSignatureCipher(format.signatureCipher);
  }

  return null;
}

export function assembleChunks(chunks: Uint8Array[], totalBytes: number) {
  const result = new Uint8Array(totalBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return result;
}
