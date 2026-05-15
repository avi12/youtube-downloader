import { state, tryUnlink } from "./mux-state";
import type { MuxVideoAudioJob } from "@/lib/download-pipeline/mux-worker-types";
import { getAudioTempExtension } from "@/lib/utils/containers";
import { AUDIO_EXTRA_STREAM_PREFIX } from "@/types";

type ExtraAudioTracks = MuxVideoAudioJob["extraAudioTracks"];
type SubtitleTracks = MuxVideoAudioJob["subtitleTracks"];

export type MuxInputFiles = {
  extraFilenames: string[];
  subtitleFilenames: string[];
};

type WriteMuxInputFilesParams = {
  videoId: string;
  videoFilename: string;
  videoData: ArrayBuffer;
  primaryAudioFilename: string;
  audioData: ArrayBuffer;
  audioMimeType: string;
  extraAudioTracks: ExtraAudioTracks;
  subtitleTracks: SubtitleTracks;
};

export function writeMuxInputFiles(params: WriteMuxInputFilesParams) {
  const { videoId, videoFilename, videoData, primaryAudioFilename, audioData, audioMimeType } = params;
  const { extraAudioTracks, subtitleTracks } = params;
  state.ffmpeg!.FS.writeFile(videoFilename, new Uint8Array(videoData));
  state.ffmpeg!.FS.writeFile(primaryAudioFilename, new Uint8Array(audioData));

  const extraFilenames: string[] = [];
  for (const [i, track] of extraAudioTracks.entries()) {
    const extraFilename = `${videoId}-${AUDIO_EXTRA_STREAM_PREFIX}-${i}.${getAudioTempExtension(audioMimeType)}`;
    state.ffmpeg!.FS.writeFile(extraFilename, new Uint8Array(track.data));
    extraFilenames.push(extraFilename);
  }

  const subtitleFilenames: string[] = [];
  for (const [i, track] of subtitleTracks.entries()) {
    const subFilename = `${videoId}-sub-${i}.vtt`;
    state.ffmpeg!.FS.writeFile(subFilename, track.data);
    subtitleFilenames.push(subFilename);
  }

  return {
    extraFilenames,
    subtitleFilenames
  };
}

export type MuxCleanupParams = {
  videoFilename: string;
  primaryAudioFilename: string;
  extraFilenames: string[];
  subtitleFilenames: string[];
  muxFilename: string;
  outputFilename: string;
  useIntermediateMkv: boolean;
  targetExtension: string;
};

export function cleanupMuxFiles(params: MuxCleanupParams) {
  tryUnlink(params.videoFilename);
  tryUnlink(params.primaryAudioFilename);
  for (const filename of [...params.extraFilenames, ...params.subtitleFilenames]) {
    tryUnlink(filename);
  }

  if (params.useIntermediateMkv) {
    tryUnlink(params.muxFilename);
  }

  if (params.targetExtension !== "mkv") {
    tryUnlink(params.outputFilename);
  }
}
