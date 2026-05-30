import type { VideoMetadata } from "@/types";

export enum WorkerMessageType {
  Init = "init",
  Ready = "ready",
  MuxVideoAudio = "muxVideoAudio",
  EmbedMetadata = "embedMetadata",
  TranscodeAudio = "transcodeAudio",
  TranscodeFile = "transcodeFile",
  Result = "result",
  ResultFile = "resultFile",
  Error = "error",
  Progress = "progress"
}

type BaseWorkerJob = {
  videoId: string;
  tabId: number;
  filenameOutput: string;
};

export type MuxVideoAudioJob = BaseWorkerJob & {
  videoData: ArrayBuffer | null;
  videoFile?: File;
  audioData: ArrayBuffer;
  extraAudioTracks: {
    data: ArrayBuffer;
    label: string;
    languageCode: string;
  }[];
  subtitleTracks: {
    data: Uint8Array;
    label: string;
    languageCode: string;
  }[];
  videoMimeType: string;
  audioMimeType: string;
  primaryAudioLabel: string;
  primaryAudioLanguageCode: string;
  defaultAudioTrackIndex: number;
};

export type EmbedMetadataJob = BaseWorkerJob & {
  audioData: ArrayBuffer;
  sourceExtension: string;
  metadata: VideoMetadata;
  thumbnailUrl?: string;
};

export type TranscodeAudioJob = BaseWorkerJob & {
  audioData: ArrayBuffer;
  sourceExtension: string;
};

export type TranscodeFileJob = {
  videoId: string;
  tabId: number;
  data: ArrayBuffer;
  sourceExtension: string;
  targetContainer: string;
  audioMimeType?: string;
  videoMimeType?: string;
  coverArtUrl?: string;
};
