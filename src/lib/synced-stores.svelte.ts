import { createMapMessenger, createSignalMessenger, createSyncedMap, createSyncedSignal } from "./synced-signal.svelte";
import type { InterruptedDownload, ProgressType, VideoData } from "@/types";

interface SabrCredentials {
  url: string;
  poToken: string;
}

export const sabrCredentials = createSyncedSignal(
  createSignalMessenger<SabrCredentials | null>("sabr-credentials"),
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

interface PlaylistMetadata {
  playlistId: string;
  playlistTitle: string;
}

export const playlistMetadataSignal = createSyncedSignal(
  createSignalMessenger<PlaylistMetadata | null>("playlist-metadata"),
  null
);

export const interruptedDownloadStore = createSyncedMap(createMapMessenger<InterruptedDownload>("interrupted-download"));
