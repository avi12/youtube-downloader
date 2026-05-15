import {
  createMapMessenger,
  createSignalMessenger,
  createSyncedMap,
  createSyncedSignal
} from "@/lib/ui/synced-signal.svelte";
import { INITIAL_OPTIONS } from "@/lib/youtube/video-helpers";
import type { InterruptedDownload, Options, ProgressType, VideoData } from "@/types";

export const CONTENT_OPTIONS = $state<Options>(INITIAL_OPTIONS);

export function initContentOptions(options: Options) {
  Object.assign(CONTENT_OPTIONS, options);
}

export const sabrCredentials = createSyncedSignal({
  messenger: createSignalMessenger<{
    url: string;
    poToken: string;
  } | null>("sabr-credentials"),
  initial: null
});

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

export const playlistMetadataSignal = createSyncedSignal({
  messenger: createSignalMessenger<{
    playlistId: string;
    playlistTitle: string;
    playlistOwner: string;
  } | null>("playlist-metadata"),
  initial: null
});

export const interruptedDownloadStore = createSyncedMap(createMapMessenger<InterruptedDownload>("interrupted-download"));
