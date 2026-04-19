import {
  createMapMessenger,
  createSignalMessenger,
  createSyncedMap,
  createSyncedSignal
} from "@/lib/ui/synced-signal.svelte";
import { initialOptions } from "@/lib/youtube/video-helpers";
import type { InterruptedDownload, Options, ProgressType, VideoData } from "@/types";

let optionsState = $state<Options>(initialOptions);

export const contentOptions = {
  get value() {
    return optionsState;
  }
};

export function initContentOptions(options: Options) {
  optionsState = options;
}

export const sabrCredentials = createSyncedSignal(
  createSignalMessenger<{
    url: string;
    poToken: string;
  } | null>("sabr-credentials"),
  null
);

export const videoDataStore = createSyncedMap(createMapMessenger<VideoData>("video-data"));
export const videoDataFailedStore = createSyncedMap(createMapMessenger<boolean>("video-data-failed"));

export const downloadProgressStore = createSyncedMap(
  createMapMessenger<{
    isDownloading: boolean;
    isDone: boolean;
    progress: number;
    progressType: ProgressType | "";
    isFailed?: boolean;
  }>("download-progress")
);

export type DownloadProgressState = Parameters<(typeof downloadProgressStore)["set"]>[1];

export const playlistMetadataSignal = createSyncedSignal(
  createSignalMessenger<{
    playlistId: string;
    playlistTitle: string;
    playlistOwner: string;
  } | null>("playlist-metadata"),
  null
);

export const interruptedDownloadStore = createSyncedMap(createMapMessenger<InterruptedDownload>("interrupted-download"));
