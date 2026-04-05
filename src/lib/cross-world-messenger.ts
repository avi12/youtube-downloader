import type { DownloadRequest, ProgressUpdate, VideoData } from "@/types";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// ─── Protocol definition ──────────────────────────────────────────────────────

export enum CrossWorldMessage {
  // MAIN world → isolated world
  VideoData = "videoData",
  Navigation = "navigation",
  PanelContentReady = "panelContentReady",
  StreamError = "streamError",

  // Isolated world / Svelte → MAIN world
  DownloadRequest = "downloadRequest",
  PanelClosed = "panelClosed",
  FilenameChanged = "filenameChanged",
  RequestVideoData = "requestVideoData",

  // MAIN world → isolated world: proxy fetch through background (CORS bypass)
  ProxyFetch = "proxyFetch",

  // Background → isolated world → MAIN world: request fresh PO token
  RefreshPoToken = "refreshPoToken",

  // Isolated world → all (MAIN world + Svelte components)
  Progress = "progress"
}

interface PageMessengerSchema {
  [CrossWorldMessage.VideoData](data: VideoData): void;
  [CrossWorldMessage.Navigation](data: { url: string }): void;
  [CrossWorldMessage.PanelContentReady](data: { contentId: string }): void;
  [CrossWorldMessage.StreamError](data: { videoId: string;
    error: string; }): void;
  [CrossWorldMessage.DownloadRequest](data: DownloadRequest): void;
  [CrossWorldMessage.PanelClosed](data: Record<string, never>): void;
  [CrossWorldMessage.FilenameChanged](data: {
    filename: string;
    quality?: string;
    videoItag?: number;
    audioItag?: number;
  }): void;
  [CrossWorldMessage.RequestVideoData](data: { videoId: string }): void;
  [CrossWorldMessage.ProxyFetch](data: { url: string;
    bodyBase64: string; }):
    { status: number;
      bodyBase64: string; } | null;
  [CrossWorldMessage.RefreshPoToken](data: { videoId: string }): string | null;
  [CrossWorldMessage.Progress](data: ProgressUpdate): void;
}

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });
