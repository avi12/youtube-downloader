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
const CODEC_MP3 = "mp3";
const CODEC_PCM_S16LE = "pcm_s16le";
const CODEC_PCM_S16BE = "pcm_s16be";
const CODEC_MP3_ENCODER = "libmp3lame";
const CODEC_OPUS_ENCODER = "libopus";
const CODEC_VORBIS_ENCODER = "libvorbis";
const SUBTITLE_CODEC_WEBVTT = "webvtt";
const SUBTITLE_CODEC_MOV_TEXT = "mov_text";

interface ContainerSpec {
  videoCodecs?: Set<string>;
  audioCodecs: Set<string>;
  fallbackAudioCodec?: string;
  allowNonNativeVideo?: boolean;
  subtitleCodec?: string;
}

export const MULTI_TRACK_UNSUPPORTED_EXTENSIONS = new Set(["avi", "3gp", "m4b"]);

type AudioOnlySpec = Pick<ContainerSpec, "audioCodecs" | "fallbackAudioCodec">;
function audioOnly({ audioCodecs, fallbackAudioCodec }: AudioOnlySpec): ContainerSpec {
  return {
    audioCodecs,
    fallbackAudioCodec
  };
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
  },
  m4v: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_AV01, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC]),
    fallbackAudioCodec: CODEC_AAC,
    allowNonNativeVideo: true,
    subtitleCodec: SUBTITLE_CODEC_MOV_TEXT
  },
  "3gp": {
    videoCodecs: new Set([CODEC_AVC1, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A]),
    fallbackAudioCodec: CODEC_AAC
  },
  ts: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_MP3]),
    fallbackAudioCodec: CODEC_AAC
  },
  mkv: {
    videoCodecs: new Set([CODEC_VP8, CODEC_VP9, CODEC_AV01, CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_OPUS, CODEC_VORBIS, CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC, CODEC_MP3]),
    fallbackAudioCodec: CODEC_OPUS_ENCODER,
    allowNonNativeVideo: true,
    subtitleCodec: SUBTITLE_CODEC_WEBVTT
  },
  m4b: audioOnly({
    audioCodecs: new Set([CODEC_MP4A, CODEC_AAC]),
    fallbackAudioCodec: CODEC_AAC
  }),
  m4a: audioOnly({
    audioCodecs: new Set([CODEC_MP4A, CODEC_AAC, CODEC_AC3, CODEC_EC3, CODEC_FLAC]),
    fallbackAudioCodec: CODEC_AAC
  }),
  mp3: audioOnly({
    audioCodecs: new Set([CODEC_MP3]),
    fallbackAudioCodec: CODEC_MP3_ENCODER
  }),
  flac: audioOnly({
    audioCodecs: new Set([CODEC_FLAC]),
    fallbackAudioCodec: CODEC_FLAC
  }),
  ogg: audioOnly({
    audioCodecs: new Set([CODEC_OPUS, CODEC_VORBIS]),
    fallbackAudioCodec: CODEC_VORBIS_ENCODER
  }),
  weba: audioOnly({
    audioCodecs: new Set([CODEC_OPUS, CODEC_VORBIS]),
    fallbackAudioCodec: CODEC_OPUS_ENCODER
  }),
  opus: audioOnly({
    audioCodecs: new Set([CODEC_OPUS]),
    fallbackAudioCodec: CODEC_OPUS_ENCODER
  }),
  wav: audioOnly({
    audioCodecs: new Set([CODEC_PCM_S16LE]),
    fallbackAudioCodec: CODEC_PCM_S16LE
  }),
  aiff: audioOnly({
    audioCodecs: new Set([CODEC_PCM_S16BE]),
    fallbackAudioCodec: CODEC_PCM_S16BE
  })
};

export function extractBaseCodec(mimeType: string) {
  return mimeType.match(/codecs="?([^",.;]+)/i)?.[1]?.toLowerCase() ?? "";
}

function videoCodecsFor(spec: ContainerSpec) {
  return spec.videoCodecs ?? new Set<string>();
}

export function getAudioFallbackCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.fallbackAudioCodec;
}

export function isAudioMimeNativeForContainer({ audioMimeType, targetExtension }: {
  audioMimeType: string;
  targetExtension: string;
}) {
  const spec = CONTAINER_SPECS[targetExtension];
  if (!spec) {
    return true;
  }

  return spec.audioCodecs.has(extractBaseCodec(audioMimeType));
}

export function getOutputExtension({ videoMimeType, audioMimeType, userExtension }: {
  videoMimeType: string;
  audioMimeType: string;
  userExtension: string;
}) {
  const containerSpec: ContainerSpec | undefined = CONTAINER_SPECS[userExtension];
  const isContainerSpecMissing = !containerSpec;
  if (isContainerSpecMissing) {
    return userExtension;
  }

  const videoCodec = extractBaseCodec(videoMimeType);
  const audioCodec = extractBaseCodec(audioMimeType);
  const isVideoNative = videoCodecsFor(containerSpec).has(videoCodec);
  const isNonNativeAllowed = !!containerSpec.allowNonNativeVideo;
  const videoOk = isVideoNative || isNonNativeAllowed;
  const isAudioNative = containerSpec.audioCodecs.has(audioCodec);
  const isFallbackAudioPresent = containerSpec.fallbackAudioCodec !== undefined;
  const audioOk = isAudioNative || isFallbackAudioPresent;
  const isCompatible = videoOk && audioOk;

  return isCompatible ? userExtension : "mkv";
}

export function isVideoNativeForContainer({ videoMimeType, targetExtension }: {
  videoMimeType: string;
  targetExtension: string;
}) {
  const containerSpec = CONTAINER_SPECS[targetExtension];
  const isSpecMissing = !containerSpec;
  if (isSpecMissing) {
    return true;
  }

  return videoCodecsFor(containerSpec).has(extractBaseCodec(videoMimeType));
}

export function isCompatibleForRemux({ videoMimeType, audioMimeType, targetExtension }: {
  videoMimeType: string;
  audioMimeType: string;
  targetExtension: string;
}) {
  const containerSpec = CONTAINER_SPECS[targetExtension];
  const isSpecMissing = !containerSpec;
  if (isSpecMissing) {
    return true;
  }

  const isVideoNative = videoCodecsFor(containerSpec).has(extractBaseCodec(videoMimeType));
  const isNonNativeAllowed = !!containerSpec.allowNonNativeVideo;
  const videoOk = isVideoNative || isNonNativeAllowed;
  const isAudioNative = containerSpec.audioCodecs.has(extractBaseCodec(audioMimeType));
  const isFallbackAudioPresent = containerSpec.fallbackAudioCodec !== undefined;
  const audioOk = isAudioNative || isFallbackAudioPresent;
  return videoOk && audioOk;
}
