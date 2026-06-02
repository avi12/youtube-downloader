const CODEC_VP8 = "vp8";
const CODEC_VP9 = "vp9";
const CODEC_VP09 = "vp09";
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
const CODEC_H264_ENCODER = "libx264";
const CODEC_VP9_ENCODER = "libvpx-vp9";
const CODEC_MPEG4_ENCODER = "mpeg4";
const SUBTITLE_CODEC_WEBVTT = "webvtt";
const SUBTITLE_CODEC_MOV_TEXT = "mov_text";

interface ContainerSpec {
  videoCodecs?: Set<string>;
  audioCodecs: Set<string>;
  fallbackAudioCodec?: string;
  fallbackVideoCodec?: string;
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
    videoCodecs: new Set([CODEC_VP8, CODEC_VP9, CODEC_VP09, CODEC_AV01]),
    audioCodecs: new Set([CODEC_OPUS, CODEC_VORBIS]),
    fallbackVideoCodec: CODEC_VP9_ENCODER,
    subtitleCodec: SUBTITLE_CODEC_WEBVTT
  },
  mp4: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_AV01, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC]),
    fallbackAudioCodec: CODEC_AAC,
    fallbackVideoCodec: CODEC_H264_ENCODER,
    allowNonNativeVideo: true,
    subtitleCodec: SUBTITLE_CODEC_MOV_TEXT
  },
  mov: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_AV01, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC]),
    fallbackAudioCodec: CODEC_AAC,
    fallbackVideoCodec: CODEC_H264_ENCODER,
    allowNonNativeVideo: true,
    subtitleCodec: SUBTITLE_CODEC_MOV_TEXT
  },
  avi: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_AC3]),
    fallbackAudioCodec: CODEC_MP3_ENCODER,
    fallbackVideoCodec: CODEC_MPEG4_ENCODER
  },
  m4v: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_AV01, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC]),
    fallbackAudioCodec: CODEC_AAC,
    fallbackVideoCodec: CODEC_H264_ENCODER,
    allowNonNativeVideo: true,
    subtitleCodec: SUBTITLE_CODEC_MOV_TEXT
  },
  "3gp": {
    videoCodecs: new Set([CODEC_AVC1, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A]),
    fallbackAudioCodec: CODEC_AAC,
    fallbackVideoCodec: CODEC_H264_ENCODER
  },
  ts: {
    videoCodecs: new Set([CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_MP4V]),
    audioCodecs: new Set([CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_MP3]),
    fallbackAudioCodec: CODEC_AAC,
    fallbackVideoCodec: CODEC_H264_ENCODER
  },
  mkv: {
    videoCodecs: new Set([
      CODEC_VP8, CODEC_VP9, CODEC_VP09, CODEC_AV01, CODEC_AVC1, CODEC_HVC1, CODEC_HEV1, CODEC_MP4V
    ]),
    audioCodecs: new Set([CODEC_OPUS, CODEC_VORBIS, CODEC_MP4A, CODEC_AC3, CODEC_EC3, CODEC_FLAC, CODEC_MP3]),
    allowNonNativeVideo: true
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

const MKV_EXTENSION = "mkv";

export function resolveMultiTrackExtension(baseExtension: string) {
  const isKnownContainer = baseExtension in CONTAINER_SPECS;
  return isKnownContainer && !MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(baseExtension) ? baseExtension : MKV_EXTENSION;
}

export function extractBaseCodec(mimeType: string) {
  return mimeType.match(/codecs="?([^",.;]+)/i)?.[1]?.toLowerCase() ?? "";
}

function videoCodecsFor(spec: ContainerSpec) {
  return spec.videoCodecs ?? new Set<string>();
}

export function getAudioFallbackCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.fallbackAudioCodec;
}

export function getVideoFallbackCodec(targetExtension: string) {
  return CONTAINER_SPECS[targetExtension]?.fallbackVideoCodec;
}

// Encoders that justify a "Slower" warning in the UI: either pathologically
// slow in software (10x+ slower than libx264) or legacy codecs whose output
// quality is materially worse than modern alternatives.
//
// Pathologically slow (encoder throughput):
// - libaom-av1: "currently the slowest of the popular AV1 encoders" —
//   https://trac.ffmpeg.org/wiki/Encode/AV1. Bitmovin's published
//   benchmarks (https://bitmovin.com/blog/av1-svt-encoding/) clock the
//   libaom reference encoder at sub-1 fps on 1080p single-thread.
// - libx265: ~5-10x slower than libx264 at comparable quality —
//   https://trac.ffmpeg.org/wiki/Encode/H.265 ("HEVC is noticeably slower
//   than H.264 to encode").
//
// Legacy quality (not necessarily slow, but produces inferior output):
// - mpeg4 (used by .avi fallback): the MPEG-4 Part 2 codec predates H.264
//   and lacks modern coding tools — see
//   https://trac.ffmpeg.org/wiki/Encode/MPEG-4 for the codec context.
//
// libvpx-vp9 is intentionally NOT in this set — it's slower than libx264
// (https://trac.ffmpeg.org/wiki/Encode/VP9) but produces modern,
// web-native output, so it's classified as "Re-encodes" rather than
// "Slower". Underlying perf reference: FFmpeg-wasm runs ~5-30x slower
// than native per https://github.com/ffmpegwasm/ffmpeg.wasm, which
// preserves the relative ordering of encoders.
const SLOW_VIDEO_ENCODERS = new Set([
  "libaom-av1",
  "libx265",
  CODEC_MPEG4_ENCODER
]);

export function isSlowVideoEncoder(encoder: string | undefined) {
  return !!encoder && SLOW_VIDEO_ENCODERS.has(encoder);
}

// Source codecs whose wasm decode path is itself the bottleneck.
// AV1 in software (dav1d / libaom-av1 decode) is the only YouTube-served
// codec that's pathologically slow to decode — Mozilla's dav1d performance
// notes (https://hacks.mozilla.org/2018/03/dav1d-1-0-faster-av1-decoder/)
// describe AV1 decode as ~4x slower than VP9 and ~10x slower than H.264
// even with dav1d's SIMD paths. VP9/H.264/HEVC decode is fast enough that
// the encoder dominates the wall-clock cost.
const SLOW_DECODE_CODECS = new Set(["av01"]);

export function isSlowDecodeCodec(videoMimeType: string) {
  return SLOW_DECODE_CODECS.has(extractBaseCodec(videoMimeType));
}

export function requiresVideoReencode({ videoMimeType, targetExtension }: {
  videoMimeType: string;
  targetExtension: string;
}) {
  const spec = CONTAINER_SPECS[targetExtension];
  const hasVideoCodecs = spec?.videoCodecs && spec.videoCodecs.size > 0;
  if (!spec || !hasVideoCodecs) {
    return false;
  }

  const sourceCodec = extractBaseCodec(videoMimeType);
  if (!sourceCodec) {
    return false;
  }

  return !videoCodecsFor(spec).has(sourceCodec);
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
