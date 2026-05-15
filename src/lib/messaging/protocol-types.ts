import type { DownloadRequest, DownloadType, ProgressType, VideoMetadata } from "@/types";

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
  /** `chrome.downloads.download` has fired and the file has reached `state: complete`. */
  isSaved?: boolean;
};
