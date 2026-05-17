import type { AdaptiveFormatItem, DownloadType, SabrConfig, VideoMetadata } from "@/types";

export const OffscreenMessageType = {
  ProcessStreamChunk: "processStreamChunk",
  ProcessStreamEnd: "processStreamEnd",
  CancelProcessing: "cancelProcessing",
  TranscodeRecentDownload: "transcodeRecentDownload",
  CreateDownloadIframe: "createDownloadIframe",
  RemoveDownloadIframe: "removeDownloadIframe",
  RevokeBlobUrl: "revokeBlobUrl",
  DownloadAudioViaSabr: "downloadAudioViaSabr"
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
    audioTrackLanguages?: string[];
    defaultAudioTrackIndex?: number;
    subtitleTracks?: {
      dataBase64: string;
      label: string;
      languageCode: string;
    }[];
    tabId: number;
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    metadata?: VideoMetadata | null;
  };
  [OffscreenMessageType.CancelProcessing]: {
    videoIds: string[];
  };
  [OffscreenMessageType.TranscodeRecentDownload]: {
    entryId: string;
    targetContainer: string;
  };
  [OffscreenMessageType.CreateDownloadIframe]: {
    videoId: string;
    watchUrl: string;
  };
  [OffscreenMessageType.RemoveDownloadIframe]: {
    videoId: string;
  };
  [OffscreenMessageType.RevokeBlobUrl]: {
    blobUrl: string;
  };
  [OffscreenMessageType.DownloadAudioViaSabr]: {
    videoId: string;
    tabId: number;
    sabrConfig: SabrConfig;
    audioFormat: AdaptiveFormatItem;
    poToken: string;
    type: DownloadType;
    filenameOutput: string;
    audioMimeType: string;
    audioTrackLabels: string[];
    audioTrackLanguages: string[];
    subtitleTracks: {
      dataBase64: string;
      label: string;
      languageCode: string;
    }[];
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    enrichedMetadata?: VideoMetadata | null;
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

export type ProcessStreamChunkData = OffscreenProtocolMap[typeof OffscreenMessageType.ProcessStreamChunk];
export type ProcessStreamEndData = OffscreenProtocolMap[typeof OffscreenMessageType.ProcessStreamEnd];
