import { state, tryUnlink } from "./mux-state";
import type { MuxVideoAudioJob } from "@/lib/download-pipeline/mux-worker-types";
import { getAudioTempExtension } from "@/lib/utils/containers";

const AUDIO_TEMP_SUFFIX = "audio";
const SUBTITLE_STREAM_PREFIX = "sub";
const VTT_EXTENSION = "vtt";
const MKV_EXTENSION = "mkv";

type AudioTracks = MuxVideoAudioJob["audioTracks"];
type SubtitleTracks = MuxVideoAudioJob["subtitleTracks"];

export type MuxInputFiles = {
  audioFilenames: string[];
  subtitleFilenames: string[];
};

type WriteMuxInputFilesParams = {
  videoId: string;
  videoFilename: string;
  videoData: ArrayBuffer;
  skipVideoWrite?: boolean;
  audioTracks: AudioTracks;
  audioMimeType: string;
  subtitleTracks: SubtitleTracks;
};

export function writeMuxInputFiles(params: WriteMuxInputFilesParams) {
  const { videoId, videoFilename, videoData, skipVideoWrite, audioTracks, audioMimeType, subtitleTracks } = params;
  if (!skipVideoWrite) {
    state.ffmpeg!.FS.writeFile(videoFilename, new Uint8Array(videoData));
  }

  const audioFilenames: string[] = [];
  for (const [i, track] of audioTracks.entries()) {
    const audioFilename = `${videoId}-${AUDIO_TEMP_SUFFIX}-${i}.${getAudioTempExtension(audioMimeType)}`;
    state.ffmpeg!.FS.writeFile(audioFilename, new Uint8Array(track.data));
    audioFilenames.push(audioFilename);
  }

  const subtitleFilenames: string[] = [];
  for (const [i, track] of subtitleTracks.entries()) {
    const subFilename = `${videoId}-${SUBTITLE_STREAM_PREFIX}-${i}.${VTT_EXTENSION}`;
    state.ffmpeg!.FS.writeFile(subFilename, track.data);
    subtitleFilenames.push(subFilename);
  }

  return {
    audioFilenames,
    subtitleFilenames
  };
}

export type MuxCleanupParams = {
  videoFilename: string;
  audioFilenames: string[];
  subtitleFilenames: string[];
  muxFilename: string;
  outputFilename: string;
  useIntermediateMkv: boolean;
  targetExtension: string;
};

export function cleanupMuxFiles(params: MuxCleanupParams) {
  tryUnlink(params.videoFilename);
  for (const filename of [...params.audioFilenames, ...params.subtitleFilenames]) {
    tryUnlink(filename);
  }

  if (params.useIntermediateMkv) {
    tryUnlink(params.muxFilename);
  }

  const isNotMkv = params.targetExtension !== MKV_EXTENSION;
  if (isNotMkv) {
    tryUnlink(params.outputFilename);
  }
}
