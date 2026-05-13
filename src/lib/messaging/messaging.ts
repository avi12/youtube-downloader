import type { DownloadRequest, DownloadType, ProgressType, VideoMetadata } from "@/types";
import { defineExtensionMessaging } from "@webext-core/messaging";

export type InterruptedDownload = {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  videoItag: number;
  audioItag: number;
  timestamp: number;
};

export const MessageType = {
  BackgroundProxyFetch: "backgroundProxyFetch",
  StreamChunk: "streamChunk",
  StreamEnd: "streamEnd",
  ProcessStreamError: "processStreamError",
  GetCapturedSabrBody: "getCapturedSabrBody",
  ClearInterruptedDownload: "clearInterruptedDownload",
  GetInterruptedDownload: "getInterruptedDownload",
  RequestPlaylistDownload: "requestPlaylistDownload",
  DownloadViaWatchPage: "downloadViaWatchPage",
  DownloadIframeReady: "downloadIframeReady",
  CancelDownload: "cancelDownload",
  StartBackgroundDownload: "startBackgroundDownload",
  StartKeepalive: "startKeepalive",
  Keepalive: "keepalive",
  ExecuteDownloadItem: "executeDownloadItem",
  SabrBodyReady: "sabrBodyReady",
  UpdateDownloadProgress: "updateDownloadProgress",
  PipelineProgress: "pipelineProgress",
  PipelineRemoval: "pipelineRemoval",
  PipelineQueueRemove: "pipelineQueueRemove",
  PipelineFFmpegReady: "pipelineFFmpegReady",
  PipelineStart: "pipelineStart",
  PipelineDownload: "pipelineDownload",
  RecentDownloadsChanged: "recentDownloadsChanged",
  TranscodeRecentDownload: "transcodeRecentDownload",
  PipelineZipProgress: "pipelineZipProgress",
  WatchDownloadCompleted: "watchDownloadCompleted",
  RevealDownloadFile: "revealDownloadFile"
} as const;

interface ProtocolMap {
  // Proxies fetch through the background SW, bypassing CORS via host_permissions + cookies.
  backgroundProxyFetch(data: {
    url: string;
    method: string;
    bodyBase64: string;
    headers: Record<string, string>;
  }): {
    status: number;
    bodyBase64: string;
    responseHeaders: Record<string, string>;
  } | null;

  // streamType is "video", "audio", or "audio-extra-{index}";
  // binary is base64 because runtime.sendMessage uses JSON serialization.
  streamChunk(data: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
  }): void;

  // audioTrackLabels[0] = primary audio label, [1..] = additional track labels.
  streamEnd(data: {
    type: DownloadType;
    videoId: string;
    filenameOutput: string;
    videoMimeType: string;
    audioMimeType: string;
    audioTrackLabels: string[];
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    metadata?: VideoMetadata | null;
  }): void;

  processStreamError(data: {
    videoId: string;
    error: string;
  }): void;

  getCapturedSabrBody(data: Record<string, never>): {
    body: string;
    url: string;
    poToken: string;
  } | null;

  clearInterruptedDownload(data: {
    videoId: string;
  }): void;
  getInterruptedDownload(data: {
    videoId: string;
  }): InterruptedDownload | null;

  downloadViaWatchPage(data: DownloadRequest): void;

  downloadIframeReady(data: {
    videoId: string;
  }): DownloadRequest | null;

  requestPlaylistDownload(data: {
    items: DownloadRequest[];
    playlistTitle?: string;
    isZipBundle: boolean;
    isSequential: boolean;
  }): void;

  cancelDownload(data: {
    videoIds: string[];
  }): void;

  startBackgroundDownload(data: DownloadRequest): void;

  startKeepalive(data: {
    videoId: string;
  }): void;

  keepalive(data: Record<string, never>): void;

  executeDownloadItem(data: DownloadRequest): void;

  sabrBodyReady(data: Record<string, never>): void;

  updateDownloadProgress(data: {
    videoId: string;
    progress: number;
    progressType: ProgressType;
    isRemoved?: boolean;
    isFailed?: boolean;
    isInterrupted?: boolean;
  }): void;

  refreshPoToken(data: {
    videoId: string;
  }): string | null;

  pipelineProgress(data: Parameters<ProtocolMap["updateDownloadProgress"]>[0] & {
    tabId: number;
  }): void;
  pipelineRemoval(data: {
    videoId: string;
    tabId: number;
  }): void;
  pipelineQueueRemove(data: {
    videoId: string;
    type: DownloadType;
  }): void;
  pipelineFFmpegReady(data: Record<string, never>): void;
  pipelineStart(data: {
    videoId: string;
    type: DownloadType;
    filenameOutput: string;
    tabId: number;
  }): void;
  pipelineDownload(data: {
    blobUrl: string;
    mimeType: string;
    filename: string;
    recentContext?: {
      videoId: string;
      title: string;
      channel: string;
      thumbnailUrl?: string;
    };
  }): void;
  recentDownloadsChanged(data: Record<string, never>): void;
  transcodeRecentDownload(data: {
    entryId: string;
    targetContainer: string;
  }): void;
  pipelineZipProgress(data: {
    playlistId: string;
    isDone: boolean;
    tabId: number;
  }): void;
  watchDownloadCompleted(data: {
    videoId: string;
    downloadId: number;
    filename: string;
  }): void;
  revealDownloadFile(data: {
    downloadId: number;
  }): void;
}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    // Allow raw runtime.sendMessage calls (e.g. __ytdl_stream binary transfer) to pass through without throwing.
    breakError: true
  });

export type ProgressUpdate = Parameters<ProtocolMap["updateDownloadProgress"]>[0];
