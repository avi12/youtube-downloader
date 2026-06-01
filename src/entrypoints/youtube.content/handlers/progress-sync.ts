import { statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore, statusProgressSignal } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

const committedToStorageIds = new Set<string>();

function markCommitted(videoId: string) {
  committedToStorageIds.add(videoId);
}

type IsOrphanedParams = {
  videoId: string;
  storedProgress: Awaited<ReturnType<typeof statusProgressItem.getValue>>;
};
function isOrphaned({ videoId, storedProgress }: IsOrphanedParams) {
  return committedToStorageIds.has(videoId)
    && !storedProgress[videoId]
    && downloadProgressStore.get(videoId)?.isDownloading;
}

function resolveOrphan(videoId: string) {
  committedToStorageIds.delete(videoId);
  downloadProgressStore.set(videoId, {
    isDownloading: false,
    isDone: true,
    progress: 1,
    progressType: ProgressType.FFmpeg
  });
}

export function syncStoredProgressToStore(
  storedProgress: Awaited<ReturnType<typeof statusProgressItem.getValue>>
) {
  statusProgressSignal.value = storedProgress;

  for (const [videoId, entry] of Object.entries(storedProgress)) {
    markCommitted(videoId);
    downloadProgressStore.set(videoId, entry);
  }

  for (const videoId of downloadProgressStore.keys()) {
    const isOrphanedDownload = isOrphaned({
      videoId,
      storedProgress
    });
    if (isOrphanedDownload) {
      resolveOrphan(videoId);
    }
  }
}

export async function restoreStoredProgress() {
  const storedProgress = await statusProgressItem.getValue();
  syncStoredProgressToStore(storedProgress);
}
