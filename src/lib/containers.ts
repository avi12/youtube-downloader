import { DownloadType } from "@/types";
import type { Options, VideoData } from "@/types";

// ─── Filename utilities ───────────────────────────────────────────────────────

export function getCompatibleFilename(filename: string) {
  // Forbidden on any OS: < > : " \ / | ? * — plus backticks, which break
  // FFmpeg WASM argument parsing.
  return filename.replaceAll(/[<>:"\\/|?*`]/g, "");
}

export function getFileExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  if (iDot === -1) {
    return "";
  }

  return filename.slice(iDot + 1);
}

export function splitFilenameAndExtension(filename: string) {
  const iDot = filename.lastIndexOf(".");
  if (iDot === -1) {
    return { name: filename, extension: "" };
  }

  return { name: filename.slice(0, iDot), extension: filename.slice(iDot + 1) };
}

// ─── Container MIME map ───────────────────────────────────────────────────────

// Containers FFmpeg can remux YouTube streams into with -c copy, plus flac
// which requires re-encoding (YouTube produces H.264/VP9/AV1 video and
// AAC/Opus/Vorbis audio).
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

function filterExtensionsByPrefix(prefix: string) {
  return Object.fromEntries(Object.entries(extensionToMimeAll).filter(([, mime]) => mime.startsWith(prefix)));
}

const extensionToMime = {
  video: filterExtensionsByPrefix("video"),
  audio: filterExtensionsByPrefix("audio")
};

export const AUTO_EXTENSION = "auto";
export const AUTO_EXTENSION_LABEL = "Auto (match source)";

export const videoContainers = Object.keys(extensionToMime.video);
export const audioContainers = Object.keys(extensionToMime.audio);

export const supportedExtensions = {
  video: [AUTO_EXTENSION, ...videoContainers],
  audio: [AUTO_EXTENSION, ...audioContainers]
};

export function resolveAutoExtension(
  extension: string, mimeType: string, type: DownloadType.Video | DownloadType.Audio
) {
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

type SupportedExtension = keyof typeof extensionToMimeAll;

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

// FFmpeg requires compatible container formats — mixing WebM and MP4 codecs
// forces MKV as the output container.
export function getOutputExtension(
  videoMimeType: string,
  audioMimeType: string,
  userExtension: string
) {
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

// ─── Download filename resolver ───────────────────────────────────────────────

export function resolveVideoFilename(videoData: VideoData, options: Options, titleOverride?: string) {
  const videoFormat = videoData.videoFormats[0] ?? null;
  const audioFormat = videoData.audioFormats[0] ?? null;
  const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
  const defaultFormat = videoData.isMusic ? audioFormat : videoFormat;
  const resolvedExtension = resolveAutoExtension(
    extPref,
    defaultFormat?.mimeType ?? "",
    videoData.isMusic ? DownloadType.Audio : DownloadType.Video
  );
  const outputExtension = videoFormat && audioFormat && !videoData.isMusic
    ? getOutputExtension(videoFormat.mimeType, audioFormat.mimeType, resolvedExtension)
    : resolvedExtension;
  const title = titleOverride ?? videoData.title;
  return getCompatibleFilename(`${title}.${outputExtension}`);
}
