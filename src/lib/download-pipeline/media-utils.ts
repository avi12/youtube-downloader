import { MessageType, sendMessage } from "../messaging";
import { getCompatibleFilename, getMimeType, uint8ToBase64 } from "../utils";

export function toUint8Array(data: Uint8Array | Record<string, number> | null) {
  if (!data) {
    return null;
  }

  if (!ArrayBuffer.isView(data)) {
    return new Uint8Array(Object.values(data));
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function triggerDownload(data: Uint8Array, filenameOutput: string) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  try {
    const blob = new Blob([new Uint8Array(data)], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    await sendMessage(MessageType.PipelineDownload, { blobUrl, mimeType, filename });
    await new Promise(resolve => setTimeout(resolve, 60_000));
    URL.revokeObjectURL(blobUrl);
  } catch {
    const blobUrl = `data:${mimeType};base64,${uint8ToBase64(data)}`;
    await sendMessage(MessageType.PipelineDownload, { blobUrl, mimeType, filename });
  }
}
