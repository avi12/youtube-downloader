import type {
  DownloadRequest,
  DownloadType,
  InterruptedDownload,
  ProgressUpdate,
  VideoMetadata,
  StreamError
} from "@/types";
import { defineExtensionMessaging } from "@webext-core/messaging";

export enum MessageType {
  BackgroundProxyFetch = "backgroundProxyFetch",
  StreamChunk = "streamChunk",
  StreamEnd = "streamEnd",
  ProcessStreamError = "processStreamError",
  GetCapturedSabrBody = "getCapturedSabrBody",
  PersistInterruptedDownload = "persistInterruptedDownload",
  ClearInterruptedDownload = "clearInterruptedDownload",
  GetInterruptedDownload = "getInterruptedDownload",
  RequestPlaylistDownload = "requestPlaylistDownload",
  DownloadViaWatchPage = "downloadViaWatchPage",
  CreateDownloadIframe = "createDownloadIframe",
  RemoveDownloadIframe = "removeDownloadIframe",
  DownloadIframeReady = "downloadIframeReady",
  CancelDownload = "cancelDownload",
  StartBackgroundDownload = "startBackgroundDownload",

  StartKeepalive = "startKeepalive",
  Keepalive = "keepalive",
  ExecuteDownloadItem = "executeDownloadItem",
  SabrBodyReady = "sabrBodyReady",
  UpdateDownloadProgress = "updateDownloadProgress",

  PipelineProgress = "pipelineProgress",
  PipelineRemoval = "pipelineRemoval",
  PipelineQueueRemove = "pipelineQueueRemove",
  PipelineFFmpegReady = "pipelineFFmpegReady",
  PipelineStart = "pipelineStart",
  PipelineDownload = "pipelineDownload",

  RecentDownloadsChanged = "recentDownloadsChanged",

  TranscodeRecentDownload = "transcodeRecentDownload",

  DiscardDownload = "discardDownload"
}

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

  processStreamError(data: StreamError): void;

  getCapturedSabrBody(data: Record<string, never>): {
    body: string;
    url: string;
    poToken: string;
  } | null;

  persistInterruptedDownload(data: InterruptedDownload): void;
  clearInterruptedDownload(data: { videoId: string }): void;
  getInterruptedDownload(data: { videoId: string }): InterruptedDownload | null;

  downloadViaWatchPage(data: DownloadRequest): void;

  createDownloadIframe(data: {
    videoId: string; watchUrl: string;
  }): void;

  removeDownloadIframe(data: { videoId: string }): void;

  downloadIframeReady(data: { videoId: string }): void;

  requestPlaylistDownload(data: {
    items: DownloadRequest[];
    playlistTitle?: string;
    isZipBundle: boolean;
    isSequential: boolean;
  }): void;

  cancelDownload(data: { videoIds: string[] }): void;

  startBackgroundDownload(data: DownloadRequest): void;

  startKeepalive(data: { videoId: string }): void;

  keepalive(data: Record<string, never>): void;

  executeDownloadItem(data: DownloadRequest): void;

  sabrBodyReady(data: Record<string, never>): void;

  updateDownloadProgress(data: ProgressUpdate): void;

  refreshPoToken(data: { videoId: string }): string | null;

  pipelineProgress(data: ProgressUpdate & { tabId: number }): void;
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
  discardDownload(data: { videoId: string }): void;
}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    // Allow raw runtime.sendMessage calls (e.g. __ytdl_stream binary transfer) to pass through without throwing.
    breakError: true
  });
