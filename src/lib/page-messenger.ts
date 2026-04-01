import type { DownloadRequest, ProgressUpdate, VideoData } from "../types";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// ─── Protocol definition ──────────────────────────────────────────────────────

interface PageMessengerSchema {
  // MAIN world → isolated world
  videoData(data: VideoData): void;
  navigation(data: { url: string }): void;
  panelContentReady(data: { contentId: string }): void;

  // Isolated world → MAIN world: SABR credentials from background webRequest
  sabrCredentials(data: { url: string; poToken: string }): void;

  // Isolated world / Svelte → MAIN world
  downloadRequest(data: DownloadRequest): void;
  cancelDownload(data: { videoIds: string[] }): void;
  panelClosed(data: Record<string, never>): void;
  filenameChanged(data: { filename: string; quality?: string; videoItag?: number; audioItag?: number }): void;
  requestVideoData(data: { videoId: string }): void;

  // Isolated world → all (MAIN world + Svelte components)
  progress(data: ProgressUpdate): void;
}

export const pageMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });
