import { getFileExtension } from "./filename";

const MIME_AUDIO_FLAC = "audio/flac";
const MIME_AUDIO_MP4 = "audio/mp4";
const MIME_VIDEO_MATROSKA = "video/x-matroska";
const MIME_AUDIO_MPEG = "audio/mpeg";
const MIME_VIDEO_MP4 = "video/mp4";
const MIME_AUDIO_OGG = "audio/ogg";
const MIME_AUDIO_OPUS = "audio/opus";
const MIME_VIDEO_WEBM = "video/webm";

const extensionToMimeAll: Record<string, string> = {
  flac: MIME_AUDIO_FLAC,
  m4a: MIME_AUDIO_MP4,
  mkv: MIME_VIDEO_MATROSKA,
  mp3: MIME_AUDIO_MPEG,
  mp4: MIME_VIDEO_MP4,
  ogg: MIME_AUDIO_OGG,
  opus: MIME_AUDIO_OPUS,
  webm: MIME_VIDEO_WEBM
};

const MIME_PREFIX_VIDEO = "video";
const EXT_WEBM = "webm";
const EXT_MP4 = "mp4";
const EXT_M4A = "m4a";

function filterExtensionsByPrefix(prefix: string) {
  return Object.fromEntries(Object.entries(extensionToMimeAll).filter(([, mime]) => mime.startsWith(prefix)));
}

const videoExtensions = filterExtensionsByPrefix(MIME_PREFIX_VIDEO);

const extensionToMime = {
  video: videoExtensions,
  audio: videoExtensions
};

export type SupportedExtension = keyof typeof extensionToMimeAll;

function isSupportedExtension(extension: string): extension is SupportedExtension {
  return extension in extensionToMimeAll;
}

export function getMimeType(filename: string) {
  const extension = getFileExtension(filename);
  const isUnsupported = !isSupportedExtension(extension);
  if (isUnsupported) {
    return null;
  }

  return extensionToMimeAll[extension];
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
