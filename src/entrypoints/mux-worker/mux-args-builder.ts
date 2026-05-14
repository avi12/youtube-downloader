import { resolveAudioCodec, resolveSubtitleCodec } from "./mux-codec-args";
import type { MuxVideoAudioJob } from "@/lib/download-pipeline/mux-worker-types";

type ExtraAudioTracks = MuxVideoAudioJob["extraAudioTracks"];
type SubtitleTracks = MuxVideoAudioJob["subtitleTracks"];

export type MuxFfmpegParams = {
  videoFilename: string;
  primaryAudioFilename: string;
  extraFilenames: string[];
  subtitleFilenames: string[];
  outputFilename: string;
  muxFilename: string;
  useIntermediateMkv: boolean;
  audioMimeType: string;
  targetExtension: string;
  extraAudioTracks: ExtraAudioTracks;
  subtitleTracks: SubtitleTracks;
  primaryAudioLabel: string;
  primaryAudioLanguageCode: string;
  defaultAudioTrackIndex: number;
  isExtraTracksPresent: boolean;
};

function appendTrackMetadata(args: string[], params: MuxFfmpegParams) {
  const audioTrackMeta = [
    {
      label: params.primaryAudioLabel,
      languageCode: params.primaryAudioLanguageCode
    },
    ...params.extraAudioTracks.map(track => ({
      label: track.label,
      languageCode: track.languageCode
    }))
  ];
  for (const [i, { label, languageCode }] of audioTrackMeta.entries()) {
    if (label) {
      args.push(`-metadata:s:a:${i}`, `title=${label}`);
    }

    if (languageCode) {
      args.push(`-metadata:s:a:${i}`, `language=${languageCode}`);
    }
  }

  for (const [i, track] of params.subtitleTracks.entries()) {
    if (track.label) {
      args.push(`-metadata:s:s:${i}`, `title=${track.label}`);
    }

    if (track.languageCode) {
      args.push(`-metadata:s:s:${i}`, `language=${track.languageCode}`);
    }
  }

  if (params.isExtraTracksPresent) {
    for (let i = 0; i < 1 + params.extraAudioTracks.length; i++) {
      args.push(`-disposition:a:${i}`, i === params.defaultAudioTrackIndex ? "default" : "0");
    }
  }
}

export function buildMuxFfmpegArgs(params: MuxFfmpegParams) {
  const {
    videoFilename, primaryAudioFilename, extraFilenames, subtitleFilenames,
    outputFilename, muxFilename, useIntermediateMkv, audioMimeType, targetExtension
  } = params;
  const args = ["-i", videoFilename, "-i", primaryAudioFilename];
  for (const filename of [...extraFilenames, ...subtitleFilenames]) {
    args.push("-i", filename);
  }

  args.push("-map", "0:v:0");
  for (let i = 0; i <= params.extraAudioTracks.length; i++) {
    args.push("-map", `${i + 1}:a:0`);
  }

  const subtitleInputOffset = 2 + params.extraAudioTracks.length;
  for (let i = 0; i < subtitleFilenames.length; i++) {
    args.push("-map", `${subtitleInputOffset + i}:s:0`);
  }

  args.push("-c:v", "copy", "-c:a", useIntermediateMkv ? "copy" : resolveAudioCodec(audioMimeType, targetExtension));

  if (subtitleFilenames.length > 0) {
    args.push("-c:s", useIntermediateMkv ? "webvtt" : resolveSubtitleCodec(targetExtension));
  }

  appendTrackMetadata(args, params);
  args.push(useIntermediateMkv ? muxFilename : outputFilename);
  return args;
}
