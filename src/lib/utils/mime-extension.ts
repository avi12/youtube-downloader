import { DownloadType } from "@/types";

const extensionToMimeAll: Record<string, string> = {
  flac: "audio/flac",
  m4a: "audio/mp4",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  weba: "audio/webm",
  webm: "video/webm"
};

function filterByPrefix(prefix: string) {
  return Object.fromEntries(
    Object.entries(extensionToMimeAll).filter(([, mime]) => mime.startsWith(prefix))
  );
}

const extensionToMime = {
  video: filterByPrefix("video"),
  audio: filterByPrefix("audio")
};

export const AUTO_EXTENSION = "auto";
export const AUTO_EXTENSION_LABEL = "Auto (match source)";

export const videoContainers = Object.keys(extensionToMime.video);
export const audioContainers = Object.keys(extensionToMime.audio);

export const supportedExtensions = {
  video: [AUTO_EXTENSION, ...videoContainers],
  audio: [AUTO_EXTENSION, ...audioContainers]
};

type SupportedExtension = keyof typeof extensionToMimeAll;

function isSupportedExtension(extension: string): extension is SupportedExtension {
  return extension in extensionToMimeAll;
}

export function getMimeTypeForExtension(extension: string) {
  if (!isSupportedExtension(extension)) {
    return null;
  }

  return extensionToMimeAll[extension];
}

export function resolveAutoExtension({ extension, mimeType, type }: {
  extension: string;
  mimeType: string;
  type: typeof DownloadType.Video | typeof DownloadType.Audio;
}) {
  if (extension !== AUTO_EXTENSION) {
    return extension;
  }

  if (mimeType.includes("webm")) {
    return type === DownloadType.Audio ? "weba" : "webm";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  return type === DownloadType.Audio ? "m4a" : "mp4";
}

export function getOutputExtension({ videoMimeType, audioMimeType, userExtension }: {
  videoMimeType: string;
  audioMimeType: string;
  userExtension: string;
}) {
  const isVideoWebm = videoMimeType.includes("webm");
  const isAudioWebm = audioMimeType.includes("webm");
  if (isVideoWebm && isAudioWebm) {
    return "webm";
  }

  if (!isVideoWebm && !isAudioWebm) {
    return userExtension;
  }

  return "mkv";
}
