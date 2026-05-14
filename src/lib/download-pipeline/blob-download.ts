import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { RecentDownloadContext } from "@/lib/messaging/messaging";
import { getCompatibleFilename, getMimeType } from "@/lib/utils/containers";

const blobUrlsPendingRevocation = new Map<string, Blob>();
const BLOB_REVOCATION_DELAY_MS = 60_000;

export async function triggerDownload({ data, filenameOutput, recentContext }: {
  data: Uint8Array;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
}) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, blob);

  await sendMessage(MessageType.PipelineDownload, {
    blobUrl,
    mimeType,
    filename,
    recentContext
  });

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    blobUrlsPendingRevocation.delete(blobUrl);
  }, BLOB_REVOCATION_DELAY_MS);
}
