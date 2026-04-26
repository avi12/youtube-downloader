import type { DownloadRequest, DownloadType, ProgressType, VideoMetadata } from "@/types";
import { defineExtensionMessaging } from "@webext-core/messaging";

export const MessageType = {
  BackgroundProxyFetch: "backgroundProxyFetch",
  StreamChunk: "streamChunk",
  StreamEnd: "streamEnd",
  ProcessStreamError: "processStreamError",
  GetCapturedSabrBody: "getCapturedSabrBody",
  PersistInterruptedDownload: "persistInterruptedDownload",
  ClearInterruptedDownload: "clearInterruptedDownload",
  GetInterruptedDownload: "getInterruptedDownload",
  RequestPlaylistDownload: "requestPlaylistDownload",
  DownloadViaWatchPage: "downloadViaWatchPage",
  CreateDownloadIframe: "createDownloadIframe",
  RemoveDownloadIframe: "removeDownloadIframe",
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
  StartIframeScrub: "startIframeScrub",
  IframeScrubSegmentReady: "iframeScrubSegmentReady",
  BgDebugLog: "bgDebugLog",
  GetSabrTemplateFromTab: "getSabrTemplateFromTab",
  SabrTemplateReady: "sabrTemplateReady"
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
    // Iframe-scrub marker — N chunks came in on video-seg-0..N-1 / audio-seg-0..N-1.
    segmentCount?: number;
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

  persistInterruptedDownload(data: {
    videoId: string;
    type: DownloadType;
    filenameOutput: string;
    videoItag: number;
    audioItag: number;
    timestamp: number;
  }): void;
  clearInterruptedDownload(data: {
    videoId: string;
  }): void;
  getInterruptedDownload(data: {
    videoId: string;
  }): Parameters<ProtocolMap["persistInterruptedDownload"]>[0] | null;

  downloadViaWatchPage(data: DownloadRequest): void;

  createDownloadIframe(data: {
    videoId: string;
    watchUrl: string;
  }): void;

  removeDownloadIframe(data: {
    videoId: string;
  }): void;

  downloadIframeReady(data: {
    videoId: string;
  }): void;

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

  // Orchestrates iframe-scrub from the background script using a hidden
  // off-screen popup window. The page hands off everything the offscreen
  // pipeline needs once segments are gathered; background fans out N tabs
  // (one per ytdlScrubIndex), each tab self-drives its capture and sends
  // an IframeScrubSegmentReady back, then background relays chunks to
  // offscreen as video-seg-N / audio-seg-N and fires StreamEnd when done.
  startIframeScrub(data: {
    videoId: string;
    durationSec: number;
    stepSec: number;
    type: DownloadType;
    filenameOutput: string;
    videoMimeType: string;
    audioMimeType: string;
    audioLabel: string;
    metadata?: VideoMetadata | null;
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
  }): void;

  iframeScrubSegmentReady(data: {
    videoId: string;
    scrubIndex: number;
    videoBase64: string;
    audioBase64: string;
    videoMimeType: string;
    audioMimeType: string;
  }): void;

  // Forwards offscreen / background diagnostic messages to a content script
  // so they're visible in the user's page console for debugging.
  bgDebugLog(data: {
    msg: string;
  }): void;

  // BG asks a tab's MAIN-world SABR interceptor for the latest captured trust
  // template. Body is base64-encoded for transport (Uint8Array doesn't survive
  // CustomEvent structured-clone reliably for some payload sizes).
  getSabrTemplateFromTab(data: Record<string, never>): {
    url: string;
    bodyBase64: string;
    capturedAt: number;
  } | null;

  // Factory tab pushes its captured trust template to BG once the player has
  // started fetching real (non-ad) content. The factory tab is opened by BG
  // and torn down once the template is received.
  sabrTemplateReady(data: {
    videoId: string;
    factoryId?: string;
    url: string;
    bodyBase64: string;
    capturedAt: number;
  }): void;
}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    // Allow raw runtime.sendMessage calls (e.g. __ytdl_stream binary transfer) to pass through without throwing.
    breakError: true
  });

export type InterruptedDownload = Parameters<ProtocolMap["persistInterruptedDownload"]>[0];
export type ProgressUpdate = Parameters<ProtocolMap["updateDownloadProgress"]>[0];
