import type { DownloadRequest, DownloadType, SubtitleStream, VideoMetadata } from "@/types";

export const OffscreenMessageType = {
  ProcessStreamChunk: "processStreamChunk",
  ProcessStreamEnd: "processStreamEnd",
  CancelProcessing: "cancelProcessing",
  PipelineDownload: "pipelineDownload",
  TranscodeRecentDownload: "transcodeRecentDownload",
  SpawnIframe: "spawnIframe",
  RemoveIframe: "removeIframe",
  ForwardToIframe: "forwardToIframe"
} as const;

export type OffscreenMessageType = (typeof OffscreenMessageType)[keyof typeof OffscreenMessageType];

export interface OffscreenProtocolMap {
  [OffscreenMessageType.ProcessStreamChunk]: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
    tabId: number;
  };
  [OffscreenMessageType.ProcessStreamEnd]: {
    type: DownloadType;
    videoId: string;
    filenameOutput: string;
    videoMimeType: string;
    audioMimeType: string;
    audioTrackLabels: string[];
    subtitleStreams?: SubtitleStream[];
    tabId: number;
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    metadata?: VideoMetadata | null;
    segmentCount?: number;
    segmentDurationSec?: number;
    totalDurationSec?: number;
    segmentVideoBufferStartSecs?: (number | undefined)[];
  };
  [OffscreenMessageType.CancelProcessing]: {
    videoIds: string[];
  };
  [OffscreenMessageType.PipelineDownload]: {
    dataUrl: string;
    filename: string;
  };
  [OffscreenMessageType.TranscodeRecentDownload]: {
    entryId: string;
    targetContainer: string;
  };
  [OffscreenMessageType.SpawnIframe]: {
    id: string;
    url: string;
  };
  [OffscreenMessageType.RemoveIframe]: {
    id: string;
  };
  [OffscreenMessageType.ForwardToIframe]: {
    iframeId: string;
    payload: DownloadRequest;
  };
}

export type OffscreenMessage = {
  [T in OffscreenMessageType]: {
    type: T;
    data: OffscreenProtocolMap[T];
  };
}[OffscreenMessageType];

export type OffscreenHandler<T extends OffscreenMessageType> = (data: OffscreenProtocolMap[T]) => void;
export type HandlerMap = { [T in OffscreenMessageType]?: OffscreenHandler<T> };
