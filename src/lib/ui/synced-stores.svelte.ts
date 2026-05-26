import {
  createMapMessenger,
  createSignalMessenger,
  createSyncedMap,
  createSyncedSignal
} from "@/lib/ui/synced-signal.svelte";
import { INITIAL_OPTIONS } from "@/lib/youtube/video-helpers";
import type { DownloadProgressEntry, InterruptedDownload, Options, VideoData } from "@/types";

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

export const downloadProgressStore = createSyncedMap(createMapMessenger<DownloadProgressEntry>("download-progress"));

export type DownloadProgressState = DownloadProgressEntry;

export const playlistMetadataSignal = createSyncedSignal({
  messenger: createSignalMessenger<{
    playlistId: string;
    playlistTitle: string;
    playlistOwner: string;
  } | null>("playlist-metadata"),
  initial: null
});

export const interruptedDownloadStore = createSyncedMap(createMapMessenger<InterruptedDownload>("interrupted-download"));
