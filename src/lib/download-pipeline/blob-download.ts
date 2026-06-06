import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { RecentDownloadContext } from "@/lib/messaging/messaging";
import { addRecentDownload, updateRecentDownloadId } from "@/lib/storage/recent-downloads-db";
import { getCompatibleFilename, getFileExtension, getMimeType } from "@/lib/utils/containers";
import type { Prettify } from "@/types";

const FALLBACK_MIME_TYPE = "application/octet-stream";

const blobUrlsPendingRevocation = new Map<string, (() => void) | null>();

type PersistAndTriggerParams = Prettify<{
  blob: Blob;
  blobUrl: string;
  filename: string;
  mimeType: string;
  recentContext?: RecentDownloadContext;
}>;
// Caching is best-effort: it must never block the actual download. addRecentDownload
// evicts the oldest entries to fit; if it still cannot (returns false) or errors, we
// skip caching this one and the file still downloads. Returns the cache entry id, or
// null when caching was skipped.
async function cacheRecentDownload({ blob, filename, mimeType, recentContext }: {
  blob: Blob;
  filename: string;
  mimeType: string;
  recentContext: RecentDownloadContext;
}) {
  const id = crypto.randomUUID();
  const isCached = await addRecentDownload({
    entry: {
      id,
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
      sourceUrl: recentContext.sourceUrl,
      completedAt: Date.now()
    },
    blob
  }).catch(() => false);
  return isCached ? id : null;
}

async function persistAndTrigger({ blob, blobUrl, filename, mimeType, recentContext }: PersistAndTriggerParams) {
  const entryId = recentContext
    ? await cacheRecentDownload({
      blob,
      filename,
      mimeType,
      recentContext
    })
    : null;

  const response = await sendMessage(MessageType.PipelineDownload, {
    blobUrl,
    mimeType,
    filename,
    recentContext
  });
  await linkCacheEntryToDownload(entryId, response?.downloadId);
}

async function linkCacheEntryToDownload(entryId: string | null, downloadId: number | undefined) {
  if (!entryId || !downloadId) {
    return;
  }

  await updateRecentDownloadId({
    id: entryId,
    downloadId
  });
}

type TriggerDownloadParams = Prettify<{
  data: Uint8Array;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
}>;
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

type TriggerDownloadFromFileParams = Prettify<{
  file: File;
  filenameOutput: string;
  recentContext?: RecentDownloadContext;
  onRevoke?: () => void;
}>;
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
