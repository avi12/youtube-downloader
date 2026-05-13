import { getFileExtension } from "./filename";

const extensionToMimeAll: Record<string, string> = {
  flac: "audio/flac",
  m4a: "audio/mp4",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  webm: "video/webm"
};

function filterExtensionsByPrefix(prefix: string) {
  return Object.fromEntries(Object.entries(extensionToMimeAll).filter(([, mime]) => mime.startsWith(prefix)));
}

const videoExtensions = filterExtensionsByPrefix("video");

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
  if (!isSupportedExtension(extension)) {
    return null;
  }

  return extensionToMimeAll[extension];
}

export function stripMimeParams(mimeType: string) {
  return mimeType.split(";")[0];
}

export function getVideoTempExtension(mimeType: string) {
  return mimeType.includes("webm") ? "webm" : "mp4";
}

export function getAudioTempExtension(mimeType: string) {
  return mimeType.includes("webm") ? "webm" : "m4a";
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
  if (extension !== AUTO_EXTENSION) {
    return extension;
  }

  return mimeType.includes("webm") ? "webm" : "mp4";
}
