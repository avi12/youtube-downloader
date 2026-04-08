import type {
  DownloadRequest,
  DownloadType,
  InterruptedDownload,
  ProgressUpdate,
  VideoMetadata,
  StreamError
} from "../types";
import { defineExtensionMessaging } from "@webext-core/messaging";

// ─── Message types ───────────────────────────────────────────────────────────

export enum MessageType {
  // Content script → Background
  StreamChunk = "streamChunk",
  StreamEnd = "streamEnd",
  ProcessStreamError = "processStreamError",
  GetCapturedSabrBody = "getCapturedSabrBody",
  SabrDownload = "sabrDownload",
  ProxyFetch = "proxyFetch",
  ResolveFormatUrls = "resolveFormatUrls",
  PersistInterruptedDownload = "persistInterruptedDownload",
  ClearInterruptedDownload = "clearInterruptedDownload",
  GetInterruptedDownload = "getInterruptedDownload",
  RequestPlaylistDownload = "requestPlaylistDownload",
  DownloadViaWatchPage = "downloadViaWatchPage",
  CreateDownloadIframe = "createDownloadIframe",
  DownloadIframeReady = "downloadIframeReady",
  CancelDownload = "cancelDownload",

  // Background → Content script
  StartKeepalive = "startKeepalive",
  Keepalive = "keepalive",

  ExecuteDownloadItem = "executeDownloadItem",
  SabrBodyReady = "sabrBodyReady",
  UpdateDownloadProgress = "updateDownloadProgress",
  RefreshPoToken = "refreshPoToken",

  // Background → Offscreen
  ProcessStreamChunk = "processStreamChunk",
  ProcessStreamEnd = "processStreamEnd",
  CancelProcessing = "cancelProcessing",

  // Background → Offscreen
  OffscreenProxyFetch = "offscreenProxyFetch",

  // Offscreen → Background
  PipelineProgress = "pipelineProgress",
  PipelineRemoval = "pipelineRemoval",
  PipelineQueueRemove = "pipelineQueueRemove",
  PipelineFFmpegReady = "pipelineFFmpegReady",
  PipelineDownload = "pipelineDownload"
}

// ─── Protocol definition ──────────────────────────────────────────────────────

interface ProtocolMap {
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
    metadata?: VideoMetadata;
  }): void;

  // Content script → Background: SABR stream fetch failed
  processStreamError(data: StreamError): void;

  // Content script → Background: get captured SABR request body for this tab
  getCapturedSabrBody(data: Record<string, never>): { body: string;
    url: string;
    poToken: string; } | null;

  // Content script → Background: run SabrStream download in the background
  // Background has host_permissions so fetch() bypasses CORS for googlevideo.com
  sabrDownload(data: {
    request: DownloadRequest;
    poToken: string;
    cookies: string;
  }): boolean;

  // Content script → Background: proxy fetch through background (CORS bypass)
  proxyFetch(data: { url: string;
    bodyBase64: string;
    cookies?: string; }):
    { status: number;
      bodyBase64: string; } | null;

  // Background → Offscreen: proxy fetch through offscreen doc (DNR applies here)
  offscreenProxyFetch(data: { url: string;
    bodyBase64: string; }):
    { status: number;
      bodyBase64: string; } | null;

  // Content script → Background: download video/audio via direct URL
  resolveFormatUrls(data: {
    videoId: string;
    videoItag: number;
    audioItag: number;
  }): {
    videoUrl: string | null;
    audioUrl: string | null;
    videoMimeType: string;
    audioMimeType: string;
  } | null;

  // Content script → Background: persist/clear/query interrupted download state
  persistInterruptedDownload(data: InterruptedDownload): void;
  clearInterruptedDownload(data: { videoId: string }): void;
  getInterruptedDownload(data: { videoId: string }): InterruptedDownload | null;

  // Content script → Background: download via hidden iframe to watch page.
  downloadViaWatchPage(data: DownloadRequest): void;

  // Background → Content script: create a hidden iframe for downloading
  createDownloadIframe(data: { videoId: string; watchUrl: string }): void;

  // Content script → Background: iframe loaded
  downloadIframeReady(data: { videoId: string }): void;

  // Content script → Background: download all items in a playlist
  requestPlaylistDownload(data: {
    items: DownloadRequest[];
    playlistTitle?: string;
    isZipBundle?: boolean;
  }): void;

  // Content script → Background: cancel one or more downloads
  cancelDownload(data: { videoIds: string[] }): void;

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

  // Background → Offscreen (Chrome only): forwarded stream chunk
  processStreamChunk(data: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
    tabId: number;
  }): void;

  // Background → Offscreen (Chrome only): all chunks forwarded, trigger processing
  processStreamEnd(data: {
    type: DownloadType;
    videoId: string;
    filenameOutput: string;
    videoMimeType: string;
    audioMimeType: string;
    audioTrackLabels: string[];
    tabId: number;
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    metadata?: VideoMetadata;
  }): void;

  // Background → Offscreen (Chrome only): cancel one or more downloads
  cancelProcessing(data: { videoIds: string[] }): void;

  // Offscreen → Background: storage operations (chrome.storage unavailable in offscreen)
  pipelineProgress(data: ProgressUpdate & { tabId: number }): void;
  pipelineRemoval(data: { videoId: string;
    tabId: number; }): void;
  pipelineQueueRemove(data: { videoId: string;
    type: DownloadType; }): void;
  pipelineFFmpegReady(data: Record<string, never>): void;
  pipelineDownload(data: { blobUrl: string;
    mimeType: string;
    filename: string; }): void;
}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    // Allow raw runtime.sendMessage calls (e.g. for binary data transfer
    // with __ytdl_stream) to pass through without throwing errors
    breakError: true
  });
