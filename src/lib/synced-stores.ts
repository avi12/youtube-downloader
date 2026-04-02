/**
 * Shared synced signal instances used by both MAIN and isolated worlds.
 *
 * Import these from either world - writes in one world automatically
 * appear as reactive updates in the other via window.postMessage.
 */

import { createSyncedMap, createSyncedSignal } from "./synced-signal";
import type { InterruptedDownload, VideoData } from "@/types";

// ─── SABR credentials (MAIN world writes, isolated world reads) ──────────

export interface SabrCredentials {
  url: string;
  poToken: string;
}

export const sabrCredentials = createSyncedSignal<SabrCredentials | null>(
  "sabr-credentials", null
);

// ─── Video data cache (MAIN world writes, isolated world reads) ──────────

export const videoDataStore = createSyncedMap<VideoData>("video-data");

// ─── Download progress (both worlds read/write) ─────────────────────────

export interface DownloadProgressState {
  isDownloading: boolean;
  isDone: boolean;
  isQueued: boolean;
  progress: number;
  progressType: string;
}

export const downloadProgressStore = createSyncedMap<DownloadProgressState>(
  "download-progress"
);

// ─── Interrupted downloads (background writes via isolated, MAIN reads) ──

export const interruptedDownloadStore = createSyncedMap<InterruptedDownload>(
  "interrupted-download"
);
