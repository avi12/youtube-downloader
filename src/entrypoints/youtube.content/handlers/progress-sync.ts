import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-messenger";
import { statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { ProgressType } from "@/types";

// Downloads only reach storage once the FFmpeg phase begins. A video that is
// isDownloading but has never appeared in storage is still in the fetch phase —
// not an orphan — so the orphan check must be gated on prior storage presence.
const committedToStorageIds = new Set<string>();

function markCommitted(videoId: string) {
  committedToStorageIds.add(videoId);
}

function isOrphaned({ videoId, storedProgress }: {
  videoId: string;
  storedProgress: Awaited<ReturnType<typeof statusProgressItem.getValue>>;
}) {
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
  emitCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    data: {
      videoId,
      progress: 1,
      progressType: ProgressType.FFmpeg
    }
  });
}

export function syncStoredProgressToStore(
  storedProgress: Awaited<ReturnType<typeof statusProgressItem.getValue>>
) {
  for (const [videoId, { progress, progressType }] of Object.entries(storedProgress)) {
    markCommitted(videoId);
    const isComplete = progress >= 1 && progressType === ProgressType.FFmpeg;
    downloadProgressStore.set(videoId, {
      isDownloading: !isComplete,
      isDone: isComplete,
      progress,
      progressType
    });
    emitCrossWorldEvent({
      type: CrossWorldEvent.ProgressUpdate,
      data: {
        videoId,
        progress,
        progressType
      }
    });
  }

  for (const videoId of downloadProgressStore.keys()) {
    if (isOrphaned({
      videoId,
      storedProgress
    })) {
      resolveOrphan(videoId);
    }
  }
}

export async function restoreStoredProgress() {
  const storedProgress = await statusProgressItem.getValue();
  syncStoredProgressToStore(storedProgress);
}
