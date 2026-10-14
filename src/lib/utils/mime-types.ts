import type { Choice } from "./choices";
import { extractBaseCodec, isAudioMimeNativeForContainer } from "./container-specs";
import { getFileExtension } from "./filename";

const MIME_AUDIO_AIFF = "audio/aiff";
const MIME_VIDEO_AVI = "video/x-msvideo";
const MIME_AUDIO_FLAC = "audio/flac";
const MIME_AUDIO_MP4 = "audio/mp4";
const MIME_AUDIO_MP4_BOOK = "audio/mp4";
const MIME_VIDEO_MATROSKA = "video/x-matroska";
const MIME_VIDEO_QUICKTIME = "video/quicktime";
const MIME_AUDIO_MPEG = "audio/mpeg";
const MIME_VIDEO_MP4 = "video/mp4";
const MIME_VIDEO_MP4_ITUNES = "video/mp4";
const MIME_VIDEO_3GP = "video/3gpp";
const MIME_VIDEO_MPEG_TS = "video/mp2t";
const MIME_AUDIO_OGG = "audio/ogg";
const MIME_AUDIO_OPUS = "audio/opus";
const MIME_AUDIO_WAV = "audio/wav";
const MIME_AUDIO_WEBM = "audio/webm";
const MIME_VIDEO_WEBM = "video/webm";

const EXTENSION_TO_MIME_ALL: Record<string, string> = {
  "3gp": MIME_VIDEO_3GP,
  aiff: MIME_AUDIO_AIFF,
  avi: MIME_VIDEO_AVI,
  flac: MIME_AUDIO_FLAC,
  m4a: MIME_AUDIO_MP4,
  m4b: MIME_AUDIO_MP4_BOOK,
  m4v: MIME_VIDEO_MP4_ITUNES,
  mkv: MIME_VIDEO_MATROSKA,
  mov: MIME_VIDEO_QUICKTIME,
  mp3: MIME_AUDIO_MPEG,
  mp4: MIME_VIDEO_MP4,
  ogg: MIME_AUDIO_OGG,
  opus: MIME_AUDIO_OPUS,
  ts: MIME_VIDEO_MPEG_TS,
  wav: MIME_AUDIO_WAV,
  weba: MIME_AUDIO_WEBM,
  webm: MIME_VIDEO_WEBM
};

const EXT_WEBM = "webm";
const EXT_MP4 = "mp4";
const EXT_M4A = "m4a";
const EXT_OPUS = "opus";
const EXT_MKV = "mkv";

// Order both lists by quality + everyday relevance, highest first. Video
// containers don't carry quality on their own, so relevance/compatibility
// is the dominant signal there. Audio sorts losslessless-first, then
// modern lossy (AAC/Opus) over legacy lossy (MP3/Vorbis), then niche.
const VIDEO_EXTENSION_ORDER = ["mp4", "mkv", "webm", "mov", "m4v", "ts", "avi", "3gp"] as const;
const AUDIO_EXTENSION_ORDER = ["flac", "wav", "aiff", "m4a", "opus", "mp3", "ogg", "weba", "m4b"] as const;

function toExtensionMap(extensions: readonly string[]) {
  return Object.fromEntries(extensions.map(extension => [extension, EXTENSION_TO_MIME_ALL[extension]]));
}

const EXTENSION_TO_MIME = {
  video: toExtensionMap(VIDEO_EXTENSION_ORDER),
  audio: toExtensionMap(AUDIO_EXTENSION_ORDER)
};

export type SupportedExtension = keyof typeof EXTENSION_TO_MIME_ALL;

function isSupportedExtension(extension: string): extension is SupportedExtension {
  return extension in EXTENSION_TO_MIME_ALL;
}

export function getMimeType(filename: string) {
  const extension = getFileExtension(filename);
  const isUnsupported = !isSupportedExtension(extension);
  if (isUnsupported) {
    return null;
  }

  return EXTENSION_TO_MIME_ALL[extension];
}

export function stripMimeParams(mimeType: string) {
  return mimeType.split(";")[0]!;
}

export function getVideoTempExtension(mimeType: string) {
  return mimeType.includes(EXT_WEBM) ? EXT_WEBM : EXT_MP4;
}

export function getAudioTempExtension(mimeType: string) {
  return mimeType.includes(EXT_WEBM) ? EXT_WEBM : EXT_M4A;
}

export const AUTO_EXTENSION = "auto";
export const AUTO_EXTENSION_LABEL = "Auto (match source)";

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  "3gp": "Old low-bitrate mobile",
  aiff: "Apple's WAV, huge files",
  avi: "Legacy, no modern codecs",
  flac: "Lossless wrap, lossy src",
  m4a: "AAC in MP4, broad support",
  m4b: "MP4 audio with chapters",
  m4v: "MP4 with iTunes flavor",
  mkv: "Many tracks, not iOS/web",
  mov: "Apple editing, codec-picky",
  mp3: "Universal, re-encoded",
  mp4: "Universal, simple tracks",
  ogg: "Vorbis, weak OS support",
  opus: "Efficient, patchy support",
  ts: "Broadcast, no chapters",
  wav: "Uncompressed, huge files",
  weba: "Opus in WebM, niche",
  webm: "Web-native, no H.264/AAC"
};

export function getFormatDescription(extension: string) {
  return FORMAT_DESCRIPTIONS[extension] ?? "";
}

export const videoContainers = Object.keys(EXTENSION_TO_MIME.video);
export const audioContainers = Object.keys(EXTENSION_TO_MIME.audio);

export const supportedExtensions = {
  video: [AUTO_EXTENSION, ...videoContainers],
  audio: [AUTO_EXTENSION, ...audioContainers]
};

export type MediaKind = keyof typeof supportedExtensions;

const AUTO_EXTENSION_DESCRIPTIONS: Record<MediaKind, string> = {
  video: "Follows the video codec: MP4 for H.264 and AV1, WebM for VP9",
  audio: "Follows the audio codec: .opus for Opus, M4A otherwise"
};

export function listContainerChoices(kind: MediaKind): Choice[] {
  return supportedExtensions[kind].map(extension => extension === AUTO_EXTENSION
    ? {
      value: extension,
      label: AUTO_EXTENSION_LABEL,
      description: AUTO_EXTENSION_DESCRIPTIONS[kind]
    }
    : {
      value: extension,
      label: extension.toUpperCase(),
      description: getFormatDescription(extension) || undefined
    });
}

const WEBM_AUDIO_EXTENSIONS = new Set([EXT_WEBM, "weba"]);

// Low-level "Auto" pick from the source streams; resolveAutoContainer feeds it the streams the
// codec settings choose
export function resolveAutoExtension({ extension, mimeType, audioMimeType, isAudio = false }: {
  extension: string;
  mimeType: string;
  audioMimeType?: string;
  isAudio?: boolean;
}) {
  const isAuto = extension === AUTO_EXTENSION;
  if (isAudio) {
    const isOpusSource = isAuto && extractBaseCodec(mimeType) === EXT_OPUS;
    if (isOpusSource) {
      return EXT_OPUS;
    }

    const isWebmAudioTarget = isAuto || WEBM_AUDIO_EXTENSIONS.has(extension);
    return isWebmAudioTarget ? EXT_M4A : extension;
  }

  if (!isAuto) {
    return extension;
  }

  const sourceContainer = mimeType.includes(EXT_WEBM) ? EXT_WEBM : EXT_MP4;
  const isAudioHeld = !audioMimeType || isAudioMimeNativeForContainer({
    audioMimeType,
    targetExtension: sourceContainer
  });
  return isAudioHeld ? sourceContainer : EXT_MKV;
}
