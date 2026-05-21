import type { MuxVideoAudioJob } from "@/lib/download-pipeline/mux-worker-types";
import { CONTAINER_SPECS, extractBaseCodec, videoContainers } from "@/lib/utils/containers";

const FFMPEG_CODEC_COPY = "copy";
const FFMPEG_SUBTITLE_CODEC_WEBVTT = "webvtt";

type ResolveAudioCodecParams = {
  audioMimeType: string;
  targetExtension: string;
};
export function resolveAudioCodec({ audioMimeType, targetExtension }: ResolveAudioCodecParams) {
  const containerSpec = CONTAINER_SPECS[targetExtension];
  if (!containerSpec) {
    return "copy";
  }

  const codec = extractBaseCodec(audioMimeType);
  const fallbackCodec = containerSpec.fallbackAudioCodec ?? FFMPEG_CODEC_COPY;
  return containerSpec.audioCodecs.has(codec) ? FFMPEG_CODEC_COPY : fallbackCodec;
}

export function resolveSubtitleCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.subtitleCodec ?? null;
}

type BuildRemuxArgsParams = {
  inputFilename: string;
  outputFilename: string;
  targetExtension: string;
  audioMimeType: string | undefined;
};
export function buildRemuxArgs({
  inputFilename,
  outputFilename,
  targetExtension,
  audioMimeType
}: BuildRemuxArgsParams) {
  const audioCodec = resolveAudioCodec({
    audioMimeType: audioMimeType ?? "",
    targetExtension
  });
  const ffmpegArgs = ["-i", inputFilename, "-map", "0", "-c:v", FFMPEG_CODEC_COPY, "-c:a", audioCodec];
  const isVideoContainer = videoContainers.includes(targetExtension);
  const subtitleCodecForRemux = isVideoContainer ? resolveSubtitleCodec(targetExtension) : null;
  const hasSubtitleCodec = !!subtitleCodecForRemux;
  if (hasSubtitleCodec) {
    ffmpegArgs.push("-c:s", subtitleCodecForRemux);
  }

  ffmpegArgs.push(outputFilename);
  return ffmpegArgs;
}

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

type AppendTrackMetadataParams = {
  ffmpegArgs: string[];
  params: MuxFfmpegParams;
};
function appendTrackMetadata({ ffmpegArgs, params }: AppendTrackMetadataParams) {
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
      ffmpegArgs.push(`-metadata:s:a:${i}`, `title=${label}`);
    }

    if (languageCode) {
      ffmpegArgs.push(`-metadata:s:a:${i}`, `language=${languageCode}`);
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

  if (params.isExtraTracksPresent) {
    for (let i = 0; i < 1 + params.extraAudioTracks.length; i++) {
      ffmpegArgs.push(`-disposition:a:${i}`, i === params.defaultAudioTrackIndex ? "default" : "0");
    }
  }
}

export function buildMuxFfmpegArgs(params: MuxFfmpegParams) {
  const {
    videoFilename, primaryAudioFilename, extraFilenames, subtitleFilenames,
    outputFilename, muxFilename, useIntermediateMkv, audioMimeType, targetExtension
  } = params;
  const ffmpegArgs = ["-i", videoFilename, "-i", primaryAudioFilename];
  for (const filename of [...extraFilenames, ...subtitleFilenames]) {
    ffmpegArgs.push("-i", filename);
  }

  ffmpegArgs.push("-map", "0:v:0");
  for (let i = 0; i <= params.extraAudioTracks.length; i++) {
    ffmpegArgs.push("-map", `${i + 1}:a:0`);
  }

  const subtitleInputOffset = 2 + params.extraAudioTracks.length;
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
