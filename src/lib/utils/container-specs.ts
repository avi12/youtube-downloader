const CODEC_VP8 = "vp8";
const CODEC_VP9 = "vp9";
const CODEC_AV01 = "av01";
const CODEC_OPUS = "opus";
const CODEC_VORBIS = "vorbis";
const CODEC_AVC1 = "avc1";
const CODEC_HVC1 = "hvc1";
const CODEC_HEV1 = "hev1";
const CODEC_MP4V = "mp4v";
const CODEC_MP4A = "mp4a";
const CODEC_AC3 = "ac-3";
const CODEC_EC3 = "ec-3";
const CODEC_FLAC = "flac";
const CODEC_AAC = "aac";
const CODEC_MP3_ENCODER = "libmp3lame";
const SUBTITLE_CODEC_WEBVTT = "webvtt";
const SUBTITLE_CODEC_MOV_TEXT = "mov_text";

interface ContainerSpec {
  videoCodecs: Set<string>;
  audioCodecs: Set<string>;
  fallbackAudioCodec?: string;
  allowNonNativeVideo?: boolean;
  subtitleCodec?: string;
}

export const CONTAINER_SPECS: Record<string, ContainerSpec> = {
  webm: {
    videoCodecs: new Set([CODEC_VP8, CODEC_VP9, CODEC_AV01]),
    audioCodecs: new Set([CODEC_OPUS, CODEC_VORBIS]),
    subtitleCodec: SUBTITLE_CODEC_WEBVTT
  },
  mp4: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_AV01, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC]),
    fallbackAudioCodec: CODEC_AAC,
    allowNonNativeVideo: true,
    subtitleCodec: SUBTITLE_CODEC_MOV_TEXT
  },
  mov: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_AV01, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC]),
    fallbackAudioCodec: CODEC_AAC,
    allowNonNativeVideo: true,
    subtitleCodec: SUBTITLE_CODEC_MOV_TEXT
  },
  avi: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_AC3]),
    fallbackAudioCodec: CODEC_MP3_ENCODER
  }
};

export function extractBaseCodec(mimeType: string) {
  return mimeType.match(/codecs="?([^",.;]+)/i)?.[1]?.toLowerCase() ?? "";
}

export function getOutputExtension({ videoMimeType, audioMimeType, userExtension }: {
  videoMimeType: string;
  audioMimeType: string;
  userExtension: string;
}) {
  const spec: ContainerSpec | undefined = CONTAINER_SPECS[userExtension];
  if (!spec) {
    return userExtension;
  }

  const videoCodec = extractBaseCodec(videoMimeType);
  const audioCodec = extractBaseCodec(audioMimeType);
  const videoOk = spec.videoCodecs.has(videoCodec) || !!spec.allowNonNativeVideo;
  const audioOk = spec.audioCodecs.has(audioCodec) || spec.fallbackAudioCodec !== undefined;

  return videoOk && audioOk ? userExtension : "mkv";
}

export function isVideoNativeForContainer({ videoMimeType, targetExtension }: {
  videoMimeType: string;
  targetExtension: string;
}) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return true;
  }

  return spec.videoCodecs.has(extractBaseCodec(videoMimeType));
}

export function isCompatibleForRemux({ videoMimeType, audioMimeType, targetExtension }: {
  videoMimeType: string;
  audioMimeType: string;
  targetExtension: string;
}) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return true;
  }

  const videoOk = spec.videoCodecs.has(extractBaseCodec(videoMimeType)) || !!spec.allowNonNativeVideo;
  const audioOk = spec.audioCodecs.has(extractBaseCodec(audioMimeType)) || spec.fallbackAudioCodec !== undefined;
  return videoOk && audioOk;
}
