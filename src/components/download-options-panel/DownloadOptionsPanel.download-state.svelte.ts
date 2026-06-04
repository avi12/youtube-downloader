import { statusProgressSignal } from "@/lib/ui/synced-stores.svelte";
import type { DownloadType, VideoData } from "@/types";

// fallow-ignore-next-line complexity
export function createDownloadStoreState(getVideoData: () => VideoData) {
  const storeEntry = $derived(statusProgressSignal.value[getVideoData().videoId]);
  const isDownloading = $derived(storeEntry?.isDownloading ?? false);
  const isDone = $derived(storeEntry?.isDone ?? false);
  const progress = $derived(storeEntry?.progress ?? 0);
  const progressType = $derived(storeEntry?.progressType ?? "");
  const isFailed = $derived(!!storeEntry?.isFailed);
  const activeVideoItag = $derived(storeEntry?.videoItag ?? null);
  const activeAudioItag = $derived(storeEntry?.audioItag ?? null);
  const activeDownloadType: DownloadType | null = $derived(storeEntry?.downloadType ?? null);

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
    }
  };
}
