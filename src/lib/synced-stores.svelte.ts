import { createMapMessenger, createSignalMessenger, createSyncedMap, createSyncedSignal } from "./synced-signal.svelte";
import type { InterruptedDownload, ProgressType, VideoData } from "@/types";

export const sabrCredentials = createSyncedSignal(
  createSignalMessenger<{
    url: string;
    poToken: string;
  } | null>("sabr-credentials"),
  null
);

export const videoDataStore = createSyncedMap(createMapMessenger<VideoData>("video-data"));

export interface DownloadProgressState {
  isDownloading: boolean;
  isDone: boolean;
  progress: number;
  progressType: ProgressType | "";
}

export const downloadProgressStore = createSyncedMap(createMapMessenger<DownloadProgressState>("download-progress"));

export const playlistMetadataSignal = createSyncedSignal(
  createSignalMessenger<{
    playlistId: string;
    playlistTitle: string;
  } | null>("playlist-metadata"),
  null
);

export const interruptedDownloadStore = createSyncedMap(createMapMessenger<InterruptedDownload>("interrupted-download"));
