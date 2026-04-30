import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { getCompatibleFilename, getMimeType } from "@/lib/utils/containers";

const blobUrlsPendingRevocation = new Map<string, Blob>();
const BLOB_REVOCATION_DELAY_MS = 60_000;
const DOWNLOAD_RETRY_INTERVAL_MS = 3_000;
const DOWNLOAD_MAX_RETRIES = 20;

type RecentContext = {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl?: string;
};

export async function triggerDownload({ data, filenameOutput, recentContext }: {
  data: Uint8Array;
  filenameOutput: string;
  recentContext?: RecentContext;
}) {
  const mimeType = getMimeType(filenameOutput) || "application/octet-stream";
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, blob);

  for (let i = 0; i < DOWNLOAD_MAX_RETRIES; i++) {
    try {
      await sendMessage(MessageType.PipelineDownload, {
        blobUrl,
        mimeType,
        filename,
        recentContext
      });
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, DOWNLOAD_RETRY_INTERVAL_MS));
    }
  }

  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
    blobUrlsPendingRevocation.delete(blobUrl);
  }, BLOB_REVOCATION_DELAY_MS);
}
