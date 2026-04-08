import type {
  ButtonViewModelData,
  DownloadRequest,
  ProgressUpdate,
  StreamDataPayload,
  VideoData
} from "@/types";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// ─── Protocol definition ──────────────────────────────────────────────────────

export enum CrossWorldMessage {
  // MAIN world → isolated world
  VideoData = "videoData",
  Navigation = "navigation",
  PanelContentReady = "panelContentReady",
  StreamError = "streamError",
  StreamData = "streamData",

  // Isolated world / Svelte → MAIN world
  DownloadRequest = "downloadRequest",
  PanelClosed = "panelClosed",
  FilenameChanged = "filenameChanged",
  RequestVideoData = "requestVideoData",
  CancelDownload = "cancelDownload",

  // MAIN world → isolated world: proxy fetch through background (CORS bypass)
  ProxyFetch = "proxyFetch",

  // Isolated world → all (MAIN world + Svelte components)
  Progress = "progress",

  // MAIN world → isolated world: player is initialized and ready to handle downloads
  IframePlayerReady = "iframePlayerReady",

  // MAIN world → isolated world: cancel an active download
  CancelRequest = "cancelRequest",

  // Isolated world / watch-button → MAIN world: trigger a download
  WatchDownloadRequest = "watchDownloadRequest",

  // Isolated world → MAIN world: set Polymer button data
  SetButtonData = "setButtonData",

  // Isolated world → MAIN world: create a grid dropdown
  CreateDropdown = "createDropdown",

  // MAIN world → isolated world: grid dropdown is ready
  DropdownReady = "dropdownReady",

  // Isolated world → MAIN world: close a grid dropdown
  CloseDropdown = "closeDropdown",

  // MAIN world → MAIN world (watch-button): progress from CDN/direct download
  DownloadProgress = "downloadProgress"
}

interface PageMessengerSchema {
  [CrossWorldMessage.VideoData](data: VideoData): void;
  [CrossWorldMessage.Navigation](data: { url: string }): void;
  [CrossWorldMessage.PanelContentReady](data: {
    contentId: string;
    videoData: VideoData;
  }): void;
  [CrossWorldMessage.StreamError](data: {
    videoId: string;
    error: string;
  }): void;
  [CrossWorldMessage.StreamData](data: StreamDataPayload): void;
  [CrossWorldMessage.DownloadRequest](data: DownloadRequest): void;
  [CrossWorldMessage.PanelClosed](data: Record<string, never>): void;
  [CrossWorldMessage.FilenameChanged](data: {
    filename: string;
    quality?: string;
    videoItag?: number;
    audioItag?: number;
  }): void;
  [CrossWorldMessage.RequestVideoData](data: { videoId: string }): void;
  [CrossWorldMessage.ProxyFetch](data: {
    url: string;
    bodyBase64: string;
  }): {
    status: number;
    bodyBase64: string;
  } | null;

  [CrossWorldMessage.Progress](data: ProgressUpdate): void;
  [CrossWorldMessage.IframePlayerReady](data: { videoId: string }): void;
  [CrossWorldMessage.CancelDownload](data: { videoIds: string[] }): void;
  [CrossWorldMessage.CancelRequest](data: { videoIds: string[] }): void;
  [CrossWorldMessage.WatchDownloadRequest](data: {
    type: DownloadRequest["type"];
    videoId: string;
    videoItag: number;
    audioItag: number;
    filenameOutput: string;
    sabrConfig: DownloadRequest["sabrConfig"];
  }): void;
  [CrossWorldMessage.SetButtonData](data: {
    selector: string;
    data: ButtonViewModelData;
  }): void;
  [CrossWorldMessage.CreateDropdown](data: {
    contentId: string;
    positionTargetSelector: string;
  }): void;
  [CrossWorldMessage.DropdownReady](data: { contentId: string }): void;
  [CrossWorldMessage.CloseDropdown](data: { videoId: string }): void;
  [CrossWorldMessage.DownloadProgress](data: {
    videoId: string;
    progress: number;
    progressType: string;
  }): void;
}

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });
