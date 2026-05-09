import type { Options, VideoData } from "@/types";

export function getCompatibleFilename(filename: string) {
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
    return {
      name: filename,
      extension: ""
    };
  }

  return {
    name: filename.slice(0, iDot),
    extension: filename.slice(iDot + 1)
  };
}

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

interface ContainerSpec {
  videoCodecs: Set<string>;
  audioCodecs: Set<string>;
  // FFmpeg codec name to transcode audio to when it isn't natively supported.
  // Absent means no audio transcode path exists; the container falls back to MKV.
  fallbackAudioCodec?: string;
}

// Codec compatibility per container. To add a new container, add one entry here.
// Containers absent from this map (e.g. MKV) impose no codec restrictions.
export const CONTAINER_SPECS: Record<string, ContainerSpec> = {
  webm: {
    videoCodecs: new Set(["vp8", "vp9", "av01"]),
    audioCodecs: new Set(["opus", "vorbis"])
    // libopus encoder absent from @ffmpeg/core — no audio transcode available
  },
  mp4: {
    videoCodecs: new Set(["avc1", "hvc1", "hev1", "av01", "mp4v"]),
    audioCodecs: new Set(["mp4a", "ac-3", "ec-3", "flac"]),
    fallbackAudioCodec: "aac"
  }
};

// Extracts the base codec identifier from a MIME type string.
// "video/webm; codecs=\"av01.0.05M.08\"" → "av01"
// "audio/mp4; codecs=\"mp4a.40.2\""      → "mp4a"
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
    return userExtension; // MKV and other unrestricted containers accept any codec
  }

  const videoCodec = extractBaseCodec(videoMimeType);
  const audioCodec = extractBaseCodec(audioMimeType);
  const videoOk = spec.videoCodecs.has(videoCodec);
  const audioOk = spec.audioCodecs.has(audioCodec) || spec.fallbackAudioCodec !== undefined;

  return videoOk && audioOk ? userExtension : "mkv";
}

export function resolveVideoFilename({ videoData, options, titleOverride }: {
  videoData: VideoData;
  options: Options;
  titleOverride?: string;
}) {
  const [videoFormat = null] = videoData.videoFormats;
  const [audioFormat = null] = videoData.audioFormats;
  const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
  const defaultFormat = videoData.isMusic ? audioFormat : videoFormat;
  const resolvedExtension = resolveAutoExtension({
    extension: extPref,
    mimeType: defaultFormat?.mimeType ?? ""
  });
  const outputExtension = videoFormat && audioFormat && !videoData.isMusic
    ? getOutputExtension({
      videoMimeType: videoFormat.mimeType,
      audioMimeType: audioFormat.mimeType,
      userExtension: resolvedExtension
    })
    : resolvedExtension;
  const title = titleOverride ?? videoData.title;
  return getCompatibleFilename(`${title}.${outputExtension}`);
}
