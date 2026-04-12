import type {
  DownloadRequest,
  DownloadType,
  InterruptedDownload,
  ProgressUpdate,
  VideoMetadata,
  StreamError
} from "@/types";
import { defineExtensionMessaging } from "@webext-core/messaging";

// ─── Message types ───────────────────────────────────────────────────────────

export enum MessageType {
  // Content script → Background
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

  // Background → Content script
  StartKeepalive = "startKeepalive",
  Keepalive = "keepalive",
  ExecuteDownloadItem = "executeDownloadItem",
  SabrBodyReady = "sabrBodyReady",
  UpdateDownloadProgress = "updateDownloadProgress",

  // Offscreen → Background
  PipelineProgress = "pipelineProgress",
  PipelineRemoval = "pipelineRemoval",
  PipelineQueueRemove = "pipelineQueueRemove",
  PipelineFFmpegReady = "pipelineFFmpegReady",
  PipelineStart = "pipelineStart",
  PipelineDownload = "pipelineDownload",

  // Background → Popup
  RecentDownloadsChanged = "recentDownloadsChanged",

  // Popup → Background
  TranscodeRecentDownload = "transcodeRecentDownload"
}

// ─── Protocol definition ──────────────────────────────────────────────────────

interface ProtocolMap {
  // Content script → Background: proxy fetch through background SW (bypasses CORS via host_permissions + cookies)
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

  // Content script → Background: stream chunk (1 MB base64-encoded segment)
  // streamType is "video", "audio", or "audio-extra-{index}" for additional language tracks
  // Binary data is base64-encoded because runtime.sendMessage uses JSON serialization
  streamChunk(data: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
  }): void;

  // Content script → Background: all chunks sent, trigger muxing/download
  // audioTrackLabels[0] = primary audio label, [1..] = additional track labels
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

  // Content script → Background: SABR stream fetch failed
  processStreamError(data: StreamError): void;

  // Content script → Background: get captured SABR request body for this tab
  getCapturedSabrBody(data: Record<string, never>): {
    body: string;
    url: string;
    poToken: string;
  } | null;

  // Content script → Background: persist/clear/query interrupted download state
  persistInterruptedDownload(data: InterruptedDownload): void;
  clearInterruptedDownload(data: { videoId: string }): void;
  getInterruptedDownload(data: { videoId: string }): InterruptedDownload | null;

  // Content script → Background: download via hidden iframe to watch page.
  downloadViaWatchPage(data: DownloadRequest): void;

  // Background → Content script: create a hidden iframe for downloading
  createDownloadIframe(data: {
    videoId: string; watchUrl: string;
  }): void;

  // Background → Content script: remove download iframe after completion
  removeDownloadIframe(data: { videoId: string }): void;

  // Content script → Background: iframe loaded
  downloadIframeReady(data: { videoId: string }): void;

  // Content script → Background: download all items in a playlist
  requestPlaylistDownload(data: {
    items: DownloadRequest[];
    playlistTitle?: string;
    isZipBundle: boolean;
    isSequential: boolean;
  }): void;

  // Content script → Background: cancel one or more downloads
  cancelDownload(data: { videoIds: string[] }): void;

  // Content script → Background: start a download in the background SW
  startBackgroundDownload(data: DownloadRequest): void;

  // Background → Content script: start pinging the SW to keep it alive
  startKeepalive(data: { videoId: string }): void;

  // Content script → Background: keepalive ping (resets SW idle timer)
  keepalive(data: Record<string, never>): void;

  // Background → Content script (per tab): trigger a single download item
  executeDownloadItem(data: DownloadRequest): void;

  // Background → Content script (per tab): SABR body captured, download ready
  sabrBodyReady(data: Record<string, never>): void;

  // Background → Content script (per tab): progress update
  updateDownloadProgress(data: ProgressUpdate): void;

  // Background → Content script (per tab): request fresh PO token
  refreshPoToken(data: { videoId: string }): string | null;

  // Offscreen → Background
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
}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    // Allow raw runtime.sendMessage calls (e.g. for binary data transfer
    // with __ytdl_stream) to pass through without throwing errors
    breakError: true
  });
