import type {
  BackgroundProxyFetchRequest,
  BackgroundProxyFetchResponse,
  CapturedSabrBody,
  InterruptedDownload,
  PipelineDownloadMessage,
  PipelineStartMessage,
  ProgressUpdate,
  RequestPlaylistDownloadMessage,
  StreamChunkMessage,
  StreamEndMessage,
  TranscodeRecentDownloadMessage
} from "./protocol-types";
import type { DownloadRequest, DownloadType } from "@/types";

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
