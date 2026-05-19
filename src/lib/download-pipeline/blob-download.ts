import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { RecentDownloadContext } from "@/lib/messaging/messaging";
import { getCompatibleFilename, getMimeType } from "@/lib/utils/containers";

const FALLBACK_MIME_TYPE = "application/octet-stream";

const blobUrlsPendingRevocation = new Map<string, (() => void) | null>();

export async function triggerDownload({ data, filenameOutput, recentContext }: {
  data: Uint8Array;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
}) {
  const mimeType = getMimeType(filenameOutput) || FALLBACK_MIME_TYPE;
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, null);

  await sendMessage(MessageType.PipelineDownload, {
    blobUrl,
    mimeType,
    filename,
    recentContext
  });
}

export async function triggerDownloadFromFile({ file, filenameOutput, recentContext, onRevoke }: {
  file: File;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
  onRevoke?: () => void;
}) {
  const mimeType = getMimeType(filenameOutput) || FALLBACK_MIME_TYPE;
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([file], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, onRevoke ?? null);

  await sendMessage(MessageType.PipelineDownload, {
    blobUrl,
    mimeType,
    filename,
    recentContext
  });
}

export function revokePendingBlobUrl(blobUrl: string) {
  URL.revokeObjectURL(blobUrl);
  const cleanup = blobUrlsPendingRevocation.get(blobUrl);
  blobUrlsPendingRevocation.delete(blobUrl);
  cleanup?.();
}
