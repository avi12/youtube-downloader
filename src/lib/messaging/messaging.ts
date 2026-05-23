import type { DownloadRequest, DownloadType, ProgressType, VideoMetadata } from "@/types";
import { defineExtensionMessaging, type GetDataType, type GetReturnType } from "@webext-core/messaging";

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
  RevealDownloadFile: "revealDownloadFile",
  DownloadBlobUrl: "downloadBlobUrl",
  RequestDirectUrlDownload: "requestDirectUrlDownload",
  RequestWatchPageFallback: "requestWatchPageFallback",
  WorkerDownloadComplete: "workerDownloadComplete",
  ReportWorkerDownloadFailed: "reportWorkerDownloadFailed",
  ForwardProgressUpdate: "forwardProgressUpdate"
} as const;

export type BackgroundProxyFetchRequest = {
  url: string;
  method: string;
  bodyBase64: string;
  headers: Record<string, string>;
};

export type BackgroundProxyFetchResponse = {
  status: number;
  bodyBase64: string;
  responseHeaders: Record<string, string>;
} | null;

export type StreamChunkMessage = {
  videoId: string;
  streamType: string;
  iChunk: number;
  totalChunks: number;
  chunkBase64: string;
};

export type StreamEndMessage = {
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
};

export type CapturedSabrBody = {
  body: string;
  url: string;
  poToken: string;
} | null;

export type RequestPlaylistDownloadMessage = {
  items: DownloadRequest[];
  playlistTitle?: string;
  isZipBundle: boolean;
  isSequential: boolean;
};

export type PipelineStartMessage = {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  tabId: number;
};

export type TranscodeRecentDownloadMessage = {
  entryId: string;
  targetContainer: string;
  filenameOutput: string;
};

export type RecentDownloadContext = {
  videoId: string;
  title: string;
  channel: string;
  thumbnailUrl?: string;
  videoMimeType?: string;
  audioMimeType?: string;
};

export type PipelineDownloadMessage = {
  blobUrl: string;
  mimeType: string;
  filename: string;
  recentContext?: RecentDownloadContext;
};

export type InterruptedDownload = {
  videoId: string;
  type: DownloadType;
  filenameOutput: string;
  videoItag: number;
  audioItag: number;
  timestamp: number;
};

export type ProgressUpdate = {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  isRemoved?: boolean;
  isFailed?: boolean;
  isInterrupted?: boolean;
  isSaved?: boolean;
};

export interface ProtocolMap {
  backgroundProxyFetch(data: BackgroundProxyFetchRequest): BackgroundProxyFetchResponse;

  streamChunk(data: StreamChunkMessage): void;

  streamEnd(data: StreamEndMessage): void;

  processStreamError(data: {
    videoId: string;
    error: string;
  }): void;

  getCapturedSabrBody(): CapturedSabrBody;

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

  requestPlaylistDownload(data: RequestPlaylistDownloadMessage): void;

  cancelDownload(data: {
    videoIds: string[];
  }): void;

  startBackgroundDownload(data: DownloadRequest): void;

  startKeepalive(data: {
    videoId: string;
  }): void;

  keepalive(): void;

  executeDownloadItem(data: DownloadRequest): void;

  sabrBodyReady(): void;

  updateDownloadProgress(data: ProgressUpdate): void;

  refreshPoToken(data: {
    videoId: string;
  }): string | null;

  pipelineProgress(data: ProgressUpdate & {
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
  pipelineFFmpegReady(): void;
  pipelineStart(data: PipelineStartMessage): void;
  pipelineDownload(data: PipelineDownloadMessage): void;
  recentDownloadsChanged(): void;
  transcodeRecentDownload(data: TranscodeRecentDownloadMessage): void;
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

  downloadBlobUrl(data: {
    blobUrl: string;
    filename: string;
    videoId: string;
  }): void;

  requestDirectUrlDownload(data: {
    videoId: string;
    tabId: number;
    request: DownloadRequest;
  }): void;

  requestWatchPageFallback(data: {
    videoId: string;
    tabId: number;
    request: DownloadRequest;
  }): void;

  workerDownloadComplete(data: {
    videoId: string;
  }): void;

  reportWorkerDownloadFailed(data: {
    videoId: string;
    tabId: number;
  }): void;

  forwardProgressUpdate(data: ProgressUpdate & {
    tabId: number;
  }): void;
}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>();

export async function sendMessageToTab<TType extends keyof ProtocolMap>(
  type: TType,
  data: GetDataType<ProtocolMap[TType]>,
  tabId: number
): Promise<GetReturnType<ProtocolMap[TType]> | undefined> {
  if (tabId < 0) {
    return undefined;
  }

  return sendMessage(type, data, tabId);
}
