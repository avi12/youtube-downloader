import type { Prettify, VideoMetadata } from "@/types";

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

type BaseWorkerJob = Prettify<{
  videoId: string;
  tabId: number;
  filenameOutput: string;
}>;

export type AudioTrack = Prettify<{
  data: ArrayBuffer;
  label: string;
  languageCode: string;
}>;

export type MuxVideoAudioJob = Prettify<BaseWorkerJob & {
  videoData: ArrayBuffer | null;
  videoFile?: File;
  audioTracks: AudioTrack[];
  subtitleTracks: {
    data: Uint8Array;
    label: string;
    languageCode: string;
  }[];
  videoMimeType: string;
  audioMimeType: string;
  defaultAudioTrackIndex: number;
}>;

export type EmbedMetadataJob = Prettify<BaseWorkerJob & {
  audioData: ArrayBuffer;
  sourceExtension: string;
  audioMimeType?: string;
  metadata: VideoMetadata;
  thumbnailUrl?: string;
}>;

export type TranscodeAudioJob = Prettify<BaseWorkerJob & {
  audioData: ArrayBuffer;
  sourceExtension: string;
}>;

export type TranscodeFileJob = Prettify<{
  videoId: string;
  tabId: number;
  data: ArrayBuffer;
  sourceExtension: string;
  targetContainer: string;
  audioMimeType?: string;
  videoMimeType?: string;
  coverArtUrl?: string;
}>;
