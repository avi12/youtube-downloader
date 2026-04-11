import type { ButtonViewModelData, DownloadRequest, StreamDataPayload, VideoData } from "@/types";
import { ProgressType } from "@/types";
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

  // MAIN world → isolated world: proxy fetch through extension context (bypasses CORS via host_permissions)
  ProxyFetch = "proxyFetch",

  // MAIN world → isolated world: player is initialized and ready to handle downloads
  IframePlayerReady = "iframePlayerReady",

  // MAIN world → isolated world: cancel an active download
  CancelRequest = "cancelRequest",

  // Isolated world → MAIN world: set Polymer button data
  SetButtonData = "setButtonData",

  // Isolated world → MAIN world: create a grid dropdown
  CreateDropdown = "createDropdown",

  // MAIN world → isolated world: grid dropdown is ready
  DropdownReady = "dropdownReady",

  // Isolated world → MAIN world: close a grid dropdown
  CloseDropdown = "closeDropdown",

  // MAIN world → MAIN world (watch-button): progress from CDN/direct download
  DownloadProgress = "downloadProgress",

  // MAIN world → isolated world: iframe fallback when SABR+CDN both fail
  DownloadViaIframe = "downloadViaIframe",

  // MAIN world → isolated world → background: start download in background SW
  StartBackgroundDownload = "startBackgroundDownload"
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
    method: string;
    bodyBase64: string;
    headers: Record<string, string>;
  }): {
    status: number;
    bodyBase64: string;
    responseHeaders: Record<string, string>;
  } | null;

  [CrossWorldMessage.IframePlayerReady](data: { videoId: string }): void;
  [CrossWorldMessage.CancelDownload](data: { videoIds: string[] }): void;
  [CrossWorldMessage.CancelRequest](data: { videoIds: string[] }): void;
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
    progressType: ProgressType;
  }): void;
  [CrossWorldMessage.DownloadViaIframe](data: DownloadRequest): void;
  [CrossWorldMessage.StartBackgroundDownload](data: DownloadRequest): void;
}

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });
