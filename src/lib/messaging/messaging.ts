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
  RecentDownloadsChanged: "recentDownloadsChanged",
  TranscodeRecentDownload: "transcodeRecentDownload",
  PipelineZipProgress: "pipelineZipProgress",
  BgDebugLog: "bgDebugLog",
  GetSabrTemplateFromTab: "getSabrTemplateFromTab",
  SabrTemplateReady: "sabrTemplateReady",
  SynthesizeSabrTemplateFromTab: "synthesizeSabrTemplateFromTab",
  RunProgressiveSabrInTab: "runProgressiveSabrInTab",
  RunCdnFetchInTab: "runCdnFetchInTab",
  PipelineTriggerDownload: "pipelineTriggerDownload",
  RequestFreshSabrPrimer: "requestFreshSabrPrimer"
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

  // BG asks the user tab's MAIN-world synthesizer for a fresh trust template
  // with `clientAbrState.playerTimeMs` mutated to the requested offset. Lets
  // chunked-SABR fan out without spawning factory iframes per offset.
  synthesizeSabrTemplateFromTab(data: {
    playerTimeMs: number;
  }): {
    url: string;
    bodyBase64: string;
    capturedAt: number;
  } | null;

  // BG asks the user tab's MAIN-world fetchProgressive engine to harvest the
  // entire video via raw SABR POSTs (no player playback, so no ads, no buffer
  // races). MAIN reports progress + final bytes back through the existing
  // CrossWorldMessage.StreamData → handleStreamData → MessageType.StreamChunk
  // pipeline.
  runProgressiveSabrInTab(data: DownloadRequest): void;

  // Firefox: BG asks the tab's MAIN world to call the player API with page
  // session cookies and fetch the resulting CDN URLs - avoids the 403 that
  // the background SW gets due to Firefox network-context isolation.
  runCdnFetchInTab(data: DownloadRequest): void;

  pipelineTriggerDownload(data: {
    pendingBlobKey: string;
    blobUrl: string;
    filename: string;
    mimeType: string;
    recentContext?: {
      videoId: string;
      title: string;
      channel: string;
      thumbnailUrl?: string;
    };
  }): boolean;

  // MAIN world requests a fresh offscreen SABR primer from BG after sps=3
  // blocks the current expire= token, so the next session gets a new quota.
  requestFreshSabrPrimer(data: {
    videoId: string;
  }): {
    url: string;
    bodyBase64: string;
  } | null;

}

export const { sendMessage, onMessage } =
  defineExtensionMessaging<ProtocolMap>({
    // Allow raw runtime.sendMessage calls (e.g. __ytdl_stream binary transfer) to pass through without throwing.
    breakError: true
  });

export type InterruptedDownload = Parameters<ProtocolMap["persistInterruptedDownload"]>[0];
export type ProgressUpdate = Parameters<ProtocolMap["updateDownloadProgress"]>[0];
