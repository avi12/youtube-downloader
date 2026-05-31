import { downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import type { DownloadType, VideoData } from "@/types";

export function createDownloadStoreState(getVideoData: () => VideoData) {
  const storeEntry = $derived(downloadProgressStore.get(getVideoData().videoId));
  const isDownloading = $derived(storeEntry?.isDownloading ?? false);
  const isDone = $derived(storeEntry?.isDone ?? false);
  const progress = $derived(storeEntry?.progress ?? 0);
  const progressType = $derived(storeEntry?.progressType ?? "");
  const isFailed = $derived(!!storeEntry?.isFailed);
  const activeVideoItag = $derived(storeEntry?.videoItag ?? null);
  const activeAudioItag = $derived(storeEntry?.audioItag ?? null);
  const activeDownloadType = $derived(storeEntry?.downloadType ?? null as DownloadType | null);

  function resetDoneState() {
    const { videoId } = getVideoData();
    const entry = storeEntry;
    if (!entry?.isDone) {
      return;
    }

    downloadProgressStore.setLocal(videoId, {
      ...entry,
      isDone: false
    });
  }

  return {
    get storeEntry() {
      return storeEntry;
    },
    get isDownloading() {
      return isDownloading;
    },
    get isDone() {
      return isDone;
    },
    get progress() {
      return progress;
    },
    get progressType() {
      return progressType;
    },
    get isFailed() {
      return isFailed;
    },
    get activeVideoItag() {
      return activeVideoItag;
    },
    get activeAudioItag() {
      return activeAudioItag;
    },
    get activeDownloadType() {
      return activeDownloadType;
    },
    resetDoneState
  };
}
