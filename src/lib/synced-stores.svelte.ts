/**
 * Shared synced signal instances used by both MAIN and isolated worlds.
 *
 * Import these from either world - writes in one world automatically
 * appear as reactive updates in the other via custom events.
 */

import { createMapMessenger, createSignalMessenger, createSyncedMap, createSyncedSignal } from "./synced-signal.svelte";
import type { DownloadRequest, InterruptedDownload, ProgressType, VideoData } from "@/types";

export { SYNC_NAMESPACE, SyncKey } from "./synced-signal.svelte";

// ─── SABR credentials (MAIN world writes, isolated world reads) ──────────

export interface SabrCredentials {
  url: string;
  poToken: string;
}

export const sabrCredentials = createSyncedSignal(
  createSignalMessenger<SabrCredentials | null>("sabr-credentials"),
  null
);

// ─── Video data (MAIN world writes, isolated world reads) ───────────────

export const videoDataStore = createSyncedMap(
  createMapMessenger<VideoData>("video-data")
);

// ─── Video data requests (isolated world writes, MAIN world reads) ──────
// Used to request video metadata for grid/playlist items.
// The MAIN world observes new entries and fetches the data.

export const videoDataRequests = createSyncedMap(
  createMapMessenger<boolean>("video-data-request")
);

// ─── Download progress (both worlds read/write) ─────────────────────────

export interface DownloadProgressState {
  isDownloading: boolean;
  isDone: boolean;
  isQueued: boolean;
  progress: number;
  progressType: ProgressType | "";
}

export const downloadProgressStore = createSyncedMap(
  createMapMessenger<DownloadProgressState>("download-progress")
);

// ─── Playlist metadata (MAIN world writes, isolated world reads) ────────

export interface PlaylistMetadata {
  playlistId: string;
  playlistTitle: string;
}

export const playlistMetadataSignal = createSyncedSignal(
  createSignalMessenger<PlaylistMetadata | null>("playlist-metadata"),
  null
);

// ─── Download requests (isolated world writes, MAIN world reads) ────────
// One-shot commands: writing triggers MAIN world to start a download.

export const downloadRequestSignal = createSyncedSignal(
  createSignalMessenger<DownloadRequest | null>("download-request"),
  null
);

// ─── Cancel requests (isolated world writes, MAIN world reads) ──────────

export const cancelRequestSignal = createSyncedSignal(
  createSignalMessenger<{ videoIds: string[] } | null>("cancel-request"),
  null
);

// ─── Button click relay (MAIN world writes, isolated world reads) ──────
// Relays Polymer button clicks from MAIN world to isolated world components.

export const buttonClickSignal = createSyncedSignal(
  createSignalMessenger<{ buttonId: string } | null>("button-click"),
  null
);

// ─── Interrupted downloads (background writes via isolated, MAIN reads) ──

export const interruptedDownloadStore = createSyncedMap(
  createMapMessenger<InterruptedDownload>("interrupted-download")
);
