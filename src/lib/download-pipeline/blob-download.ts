import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { RecentDownloadContext } from "@/lib/messaging/messaging";
import { addRecentDownload, updateRecentDownloadId } from "@/lib/storage/recent-downloads-db";
import { getCompatibleFilename, getFileExtension, getMimeType } from "@/lib/utils/containers";

const FALLBACK_MIME_TYPE = "application/octet-stream";

const blobUrlsPendingRevocation = new Map<string, (() => void) | null>();

type PersistAndTriggerParams = {
  blob: Blob;
  blobUrl: string;
  filename: string;
  mimeType: string;
  recentContext?: RecentDownloadContext;
};
async function persistAndTrigger({ blob, blobUrl, filename, mimeType, recentContext }: PersistAndTriggerParams) {
  let entryId: string | null = null;
  if (recentContext) {
    entryId = crypto.randomUUID();
    await addRecentDownload({
      entry: {
        id: entryId,
        downloadId: 0,
        videoId: recentContext.videoId,
        title: recentContext.title,
        channel: recentContext.channel,
        filename,
        container: getFileExtension(filename),
        mimeType,
        videoMimeType: recentContext.videoMimeType,
        audioMimeType: recentContext.audioMimeType,
        size: blob.size,
        thumbnailUrl: recentContext.thumbnailUrl,
        tabId: recentContext.tabId,
        quality: recentContext.quality,
        completedAt: Date.now()
      },
      blob
    });
  }

  const response = await sendMessage(MessageType.PipelineDownload, {
    blobUrl,
    mimeType,
    filename,
    recentContext
  });
  if (entryId && response?.downloadId) {
    await updateRecentDownloadId({
      id: entryId,
      downloadId: response.downloadId
    });
  }
}

type TriggerDownloadParams = {
  data: Uint8Array;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
};
export async function triggerDownload({ data, filenameOutput, recentContext }: TriggerDownloadParams) {
  const mimeType = getMimeType(filenameOutput) || FALLBACK_MIME_TYPE;
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([new Uint8Array(data)], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, null);

  await persistAndTrigger({
    blob,
    blobUrl,
    filename,
    mimeType,
    recentContext
  });
}

type TriggerDownloadFromFileParams = {
  file: File;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
  onRevoke?: () => void;
};
export async function triggerDownloadFromFile({
  file, filenameOutput, recentContext, onRevoke
}: TriggerDownloadFromFileParams) {
  const mimeType = getMimeType(filenameOutput) || FALLBACK_MIME_TYPE;
  const filename = getCompatibleFilename(filenameOutput);
  const blob = new Blob([file], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  blobUrlsPendingRevocation.set(blobUrl, onRevoke ?? null);

  await persistAndTrigger({
    blob,
    blobUrl,
    filename,
    mimeType,
    recentContext
  });
}

export function revokePendingBlobUrl(blobUrl: string) {
  URL.revokeObjectURL(blobUrl);
  const cleanup = blobUrlsPendingRevocation.get(blobUrl);
  blobUrlsPendingRevocation.delete(blobUrl);
  cleanup?.();
}
