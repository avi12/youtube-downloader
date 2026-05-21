import { getFileExtension } from "./filename";

const MIME_AUDIO_AIFF = "audio/aiff";
const MIME_VIDEO_AVI = "video/x-msvideo";
const MIME_AUDIO_FLAC = "audio/flac";
const MIME_AUDIO_MP4 = "audio/mp4";
const MIME_VIDEO_MATROSKA = "video/x-matroska";
const MIME_VIDEO_QUICKTIME = "video/quicktime";
const MIME_AUDIO_MPEG = "audio/mpeg";
const MIME_VIDEO_MP4 = "video/mp4";
const MIME_AUDIO_OGG = "audio/ogg";
const MIME_AUDIO_OPUS = "audio/opus";
const MIME_AUDIO_WAV = "audio/wav";
const MIME_VIDEO_WEBM = "video/webm";

const EXTENSION_TO_MIME_ALL: Record<string, string> = {
  aiff: MIME_AUDIO_AIFF,
  avi: MIME_VIDEO_AVI,
  flac: MIME_AUDIO_FLAC,
  m4a: MIME_AUDIO_MP4,
  mkv: MIME_VIDEO_MATROSKA,
  mov: MIME_VIDEO_QUICKTIME,
  mp3: MIME_AUDIO_MPEG,
  mp4: MIME_VIDEO_MP4,
  ogg: MIME_AUDIO_OGG,
  opus: MIME_AUDIO_OPUS,
  wav: MIME_AUDIO_WAV,
  webm: MIME_VIDEO_WEBM
};

const EXT_WEBM = "webm";
const EXT_MP4 = "mp4";
const EXT_M4A = "m4a";

const VIDEO_EXTENSION_ORDER = ["mp4", "webm", "mkv", "mov", "avi"] as const;
const AUDIO_EXTENSION_ORDER = ["webm", "mp3", "m4a", "flac", "opus", "ogg", "wav", "aiff"] as const;

function toExtensionMap(extensions: readonly string[]) {
  return Object.fromEntries(extensions.map(extension => [extension, EXTENSION_TO_MIME_ALL[extension]]));
}

const extensionToMime = {
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
  return mimeType.split(";")[0];
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
  aiff: "Lossless, macOS",
  avi: "Legacy Windows",
  flac: "Lossless, compressed",
  m4a: "AAC audio",
  mkv: "Universal, multi-track",
  mov: "QuickTime / macOS",
  mp3: "Most compatible",
  mp4: "Most compatible",
  ogg: "Vorbis audio",
  opus: "Modern, efficient",
  wav: "Lossless, uncompressed",
  webm: "Native YouTube format"
};

export function getFormatDescription(extension: string) {
  return FORMAT_DESCRIPTIONS[extension] ?? "";
}

export const videoContainers = Object.keys(extensionToMime.video);
export const audioContainers = Object.keys(extensionToMime.audio);

export const supportedExtensions = {
  video: [AUTO_EXTENSION, ...videoContainers],
  audio: [AUTO_EXTENSION, ...audioContainers]
};

export function resolveAutoExtension({ extension, mimeType }: {
  extension: string;
  mimeType: string;
}) {
  const isAuto = extension === AUTO_EXTENSION;
  if (!isAuto) {
    return extension;
  }

  return mimeType.includes(EXT_WEBM) ? EXT_WEBM : EXT_MP4;
}
