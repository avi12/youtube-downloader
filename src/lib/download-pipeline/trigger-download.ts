import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { storePendingBlob } from "@/lib/storage/recent-downloads-db";
import { getCompatibleFilename, getMimeType } from "@/lib/utils/containers";

const BLOB_REVOCATION_DELAY_MS = 60_000;

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
  // Offscreen doc creates the blob URL (URL.createObjectURL works here, not in SW).
  const blobUrl = URL.createObjectURL(blob);
  const pendingBlobKey = `pending:${crypto.randomUUID()}`;
  await storePendingBlob(pendingBlobKey, blob);
  const success = await sendMessage(MessageType.PipelineTriggerDownload, {
    pendingBlobKey,
    blobUrl,
    filename,
    mimeType,
    recentContext
  });
  if (!success) {
    console.error("[ytdl:pipeline] triggerDownload: background download failed for", filename);
  }

  // Revoke after a delay long enough for the download manager to have fetched the blob
  // and for persistRecentDownload in the background to have read it from IDB.
  setTimeout(() => URL.revokeObjectURL(blobUrl), BLOB_REVOCATION_DELAY_MS);
}
