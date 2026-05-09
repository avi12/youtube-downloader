import type { VideoMetadata } from "@/types";

export enum WorkerMessageType {
  Init = "init",
  Ready = "ready",
  MuxVideoAudio = "muxVideoAudio",
  EmbedMetadata = "embedMetadata",
  TranscodeAudio = "transcodeAudio",
  TranscodeFile = "transcodeFile",
  Result = "result",
  Error = "error",
  Progress = "progress"
}

export type MuxVideoAudioJob = {
  videoData: ArrayBuffer;
  audioData: ArrayBuffer;
  extraAudioTracks: {
    data: ArrayBuffer;
    label: string;
  }[];
  subtitleTracks: {
    data: Uint8Array;
    label: string;
    languageCode: string;
  }[];
  videoMimeType: string;
  audioMimeType: string;
  videoId: string;
  tabId: number;
  primaryAudioLabel: string;
  filenameOutput: string;
};

export type EmbedMetadataJob = {
  audioData: ArrayBuffer;
  filenameOutput: string;
  sourceExtension: string;
  metadata: VideoMetadata;
  thumbnailUrl?: string;
  videoId: string;
  tabId: number;
};

export type TranscodeAudioJob = {
  audioData: ArrayBuffer;
  sourceExtension: string;
  filenameOutput: string;
  videoId: string;
  tabId: number;
};

export type TranscodeFileJob = {
  data: ArrayBuffer;
  sourceExtension: string;
  targetContainer: string;
};
