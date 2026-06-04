import type { MuxVideoAudioJob } from "@/lib/download-pipeline/mux-worker-types";
import { CONTAINER_SPECS, extractBaseCodec, isVideoNativeForContainer, videoContainers } from "@/lib/utils/containers";
import type { Prettify } from "@/types";

const FFMPEG_CODEC_COPY = "copy";
const FFMPEG_SUBTITLE_CODEC_WEBVTT = "webvtt";

type ResolveAudioCodecParams = Prettify<{
  audioMimeType: string;
  targetExtension: string;
}>;
export function resolveAudioCodec({ audioMimeType, targetExtension }: ResolveAudioCodecParams) {
  const containerSpec = CONTAINER_SPECS[targetExtension];
  if (!containerSpec) {
    return "copy";
  }

  const codec = extractBaseCodec(audioMimeType);
  const fallbackCodec = containerSpec.fallbackAudioCodec ?? FFMPEG_CODEC_COPY;
  return containerSpec.audioCodecs.has(codec) ? FFMPEG_CODEC_COPY : fallbackCodec;
}

type ResolveVideoCodecParams = Prettify<{
  videoMimeType: string | undefined;
  targetExtension: string;
}>;
export function resolveVideoCodec({ videoMimeType, targetExtension }: ResolveVideoCodecParams) {
  if (!videoMimeType) {
    return FFMPEG_CODEC_COPY;
  }

  const isNative = isVideoNativeForContainer({
    videoMimeType,
    targetExtension
  });
  if (isNative) {
    return FFMPEG_CODEC_COPY;
  }

  return CONTAINER_SPECS[targetExtension]?.fallbackVideoCodec ?? FFMPEG_CODEC_COPY;
}

export function resolveSubtitleCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.subtitleCodec ?? null;
}

type BuildRemuxArgsParams = Prettify<{
  inputFilename: string;
  outputFilename: string;
  targetExtension: string;
  audioMimeType: string | undefined;
  videoMimeType?: string;
}>;
export function buildRemuxArgs({
  inputFilename,
  outputFilename,
  targetExtension,
  audioMimeType,
  videoMimeType
}: BuildRemuxArgsParams) {
  const audioCodec = resolveAudioCodec({
    audioMimeType: audioMimeType ?? "",
    targetExtension
  });
  const videoCodec = resolveVideoCodec({
    videoMimeType,
    targetExtension
  });
  const ffmpegArgs = ["-i", inputFilename, "-map", "0", "-c:v", videoCodec, "-c:a", audioCodec];
  const isVideoContainer = videoContainers.includes(targetExtension);
  const subtitleCodecForRemux = isVideoContainer ? resolveSubtitleCodec(targetExtension) : null;
  const hasSubtitleCodec = !!subtitleCodecForRemux;
  if (hasSubtitleCodec) {
    ffmpegArgs.push("-c:s", subtitleCodecForRemux);
  }

  ffmpegArgs.push(outputFilename);
  return ffmpegArgs;
}

type AudioTracks = MuxVideoAudioJob["audioTracks"];
type SubtitleTracks = MuxVideoAudioJob["subtitleTracks"];

export type MuxFfmpegParams = Prettify<{
  videoFilename: string;
  audioFilenames: string[];
  subtitleFilenames: string[];
  outputFilename: string;
  muxFilename: string;
  useIntermediateMkv: boolean;
  audioMimeType: string;
  targetExtension: string;
  audioTracks: AudioTracks;
  subtitleTracks: SubtitleTracks;
  defaultAudioTrackIndex: number;
}>;

type AppendTrackMetadataParams = Prettify<{
  ffmpegArgs: string[];
  params: MuxFfmpegParams;
}>;
function appendTrackMetadata({ ffmpegArgs, params }: AppendTrackMetadataParams) {
  for (const [i, track] of params.audioTracks.entries()) {
    if (track.label) {
      ffmpegArgs.push(`-metadata:s:a:${i}`, `title=${track.label}`);
    }

    if (track.languageCode) {
      ffmpegArgs.push(`-metadata:s:a:${i}`, `language=${track.languageCode}`);
    }
  }

  for (const [i, track] of params.subtitleTracks.entries()) {
    if (track.label) {
      ffmpegArgs.push(`-metadata:s:s:${i}`, `title=${track.label}`);
    }

    if (track.languageCode) {
      ffmpegArgs.push(`-metadata:s:s:${i}`, `language=${track.languageCode}`);
    }
  }

  const isMultiTrack = params.audioTracks.length > 1;
  if (isMultiTrack) {
    for (let i = 0; i < params.audioTracks.length; i++) {
      ffmpegArgs.push(`-disposition:a:${i}`, i === params.defaultAudioTrackIndex ? "default" : "0");
    }
  }
}

export function buildMuxFfmpegArgs(params: MuxFfmpegParams) {
  const {
    videoFilename, audioFilenames, subtitleFilenames,
    outputFilename, muxFilename, useIntermediateMkv, audioMimeType, targetExtension
  } = params;

  const ffmpegArgs = ["-i", videoFilename];
  for (const filename of [...audioFilenames, ...subtitleFilenames]) {
    ffmpegArgs.push("-i", filename);
  }

  ffmpegArgs.push("-map", "0:v:0");
  for (let i = 0; i < audioFilenames.length; i++) {
    ffmpegArgs.push("-map", `${i + 1}:a:0`);
  }

  const subtitleInputOffset = 1 + audioFilenames.length;
  for (let i = 0; i < subtitleFilenames.length; i++) {
    ffmpegArgs.push("-map", `${subtitleInputOffset + i}:s:0`);
  }

  ffmpegArgs.push(
    "-c:v", FFMPEG_CODEC_COPY, "-c:a", useIntermediateMkv ? FFMPEG_CODEC_COPY : resolveAudioCodec({
      audioMimeType,
      targetExtension
    })
  );

  const hasSubtitleFiles = subtitleFilenames.length > 0;
  if (hasSubtitleFiles) {
    const subtitleCodec = useIntermediateMkv ? FFMPEG_SUBTITLE_CODEC_WEBVTT : resolveSubtitleCodec(targetExtension);
    if (subtitleCodec) {
      ffmpegArgs.push("-c:s", subtitleCodec);
    }
  }

  appendTrackMetadata({
    ffmpegArgs,
    params
  });
  ffmpegArgs.push(useIntermediateMkv ? muxFilename : outputFilename);
  return ffmpegArgs;
}
