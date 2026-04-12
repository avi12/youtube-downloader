import { DownloadType, ProgressType, VideoQualityMode } from "@/types";
import type { AdaptiveFormatItem, Options, PlayerResponse, VideoData } from "@/types";
import { PlayabilityStatus } from "@/types/youtube";

// ─── Filename utilities ───────────────────────────────────────────────────────

export function getCompatibleFilename(filename: string) {
  // Remove characters forbidden on any OS: < > : " \ / | ? *
  // Also remove backticks which break FFmpeg WASM arg parsing
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

// ─── MIME types ───────────────────────────────────────────────────────────────

// Only containers that FFmpeg can remux YouTube streams into with -c copy.
// YouTube produces H.264/VP9/AV1 video and AAC/Opus/Vorbis audio.
const extensionToMimeAll: Record<string, string> = {
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

export const supportedExtensions = {
  video: [AUTO_EXTENSION, ...Object.keys(extensionToMime.video)],
  audio: [AUTO_EXTENSION, ...Object.keys(extensionToMime.audio)]
};

/**
 * Resolves "auto" to the natural container for the given MIME type.
 * Pass-through for explicit extensions.
 */
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

// ─── Container format utilities ──────────────────────────────────────────────

/**
 * Determines the actual output container extension based on the video and audio
 * stream codecs. FFmpeg requires compatible container formats - mixing webm and
 * mp4 codecs requires MKV as the container.
 */
export function getOutputExtension(
  videoMimeType: string,
  audioMimeType: string,
  userExtension: string
) {
  const isVideoWebm = videoMimeType.includes("webm");
  const isAudioWebm = audioMimeType.includes("webm");  if (isVideoWebm && isAudioWebm) {
    return "webm";
  }

  if (!isVideoWebm && !isAudioWebm) {
    return userExtension;
  }

  return "mkv";
}

// ─── Video quality utilities ──────────────────────────────────────────────────

export const videoQualities = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

const defaultVideoQuality = 1080;

export const initialOptions: Options = {
  ext: {
    audio: AUTO_EXTENSION,
    video: AUTO_EXTENSION
  },
  defaultDownloadType: "auto",
  videoQualityMode: VideoQualityMode.CurrentQuality,
  videoQuality: defaultVideoQuality,
  isRemoveNativeDownload: false
};

// ─── YouTube utilities ────────────────────────────────────────────────────────

export function isVideoLive(playerResponse: PlayerResponse) {
  // isLive indicates currently live. isLiveContent means "this was/is
  // live content" which includes past live streams that are downloadable,
  // so we must NOT check it here.
  return Boolean(playerResponse.videoDetails?.isLive);
}

export function isVideoDownloadable(playerResponse: PlayerResponse) {
  if (isVideoLive(playerResponse)) {
    return false;
  }

  const { status } = playerResponse.playabilityStatus;
  if (status === PlayabilityStatus.LoginRequired || status === PlayabilityStatus.Error) {
    return false;
  }

  const { streamingData } = playerResponse;
  if (!streamingData) {
    return false;
  }

  const formats = streamingData.adaptiveFormats ?? [];
  return formats.some(format => Boolean(format.url) || Boolean(format.signatureCipher))
    || Boolean(streamingData.serverAbrStreamingUrl);
}

export function isVideoMusic(playerResponse: PlayerResponse) {
  return (
    playerResponse.microformat?.playerMicroformatRenderer.category === "Music"
  );
}

// ─── DOM utilities ────────────────────────────────────────────────────────────

export async function waitForVideoElement(signal?: AbortSignal) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const elVideo = document.querySelector<HTMLVideoElement>("video");
      if (!elVideo || elVideo.videoHeight === 0) {
        return;
      }

      observer.disconnect();
      resolve(elVideo);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    signal?.addEventListener("abort", () => {
      observer.disconnect();
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

// ─── Binary utilities ─────────────────────────────────────────────────────────

/**
 * Converts a Uint8Array to a base64 string using batched String.fromCharCode
 * to avoid stack overflow on large arrays.
 */
export function uint8ToBase64(bytes: Uint8Array) {
  const batchSize = 8192;
  let binary = "";

  for (let offset = 0; offset < bytes.byteLength; offset += batchSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + batchSize, bytes.byteLength)));
  }

  return btoa(binary);
}

// ─── URL utilities ────────────────────────────────────────────────────────────

/** Extracts the YouTube video ID from a watch URL (?v=...). Returns null if not found. */
export function getVideoIdFromUrl(url: string) {
  try {
    return new URLSearchParams(new URL(url).search).get("v");
  } catch {
    return null;
  }
}

// ─── Format display utilities ─────────────────────────────────────────────────

export function formatVideoQualityLabel(format: Pick<AdaptiveFormatItem, "height" | "fps" | "qualityLabel">) {
  const base = `${format.height}p${format.fps ? ` ${format.fps}fps` : ""}`;
  const isPremium = format.qualityLabel?.includes("Premium") ?? false;
  return isPremium ? `${base} (Enhanced)` : base;
}

export function formatAudioCodecLabel(mimeType: string) {
  const codecMatch = mimeType.match(/codecs="([^"]+)"/);
  const codec = codecMatch?.[1] ?? "";
  if (codec.startsWith("mp4a")) {
    return "AAC";
  }

  if (codec === "opus") {
    return "Opus";
  }

  if (codec.startsWith("ec-3")) {
    return "EC-3";
  }

  return codec || (mimeType.split(";")[0].split("/")[1] ?? "");
}

/**
 * Calculates weighted download progress: download phase = 0–70%, mux phase = 70–100%.
 * Both phases report their own 0–1 progress value.
 * When progress reaches 100%, the browser download starts immediately.
 */
export function calculateWeightedProgress(isDownloading: boolean, progress: number, progressType: ProgressType | "") {
  if (!isDownloading) {
    return 0;
  }

  if (progressType === ProgressType.FFmpeg) {
    return 70 + progress * 30;
  }

  return progress * 70;
}

// ─── Download utilities ───────────────────────────────────────────────────────

/**
 * Resolves the output filename for a video download based on its formats and options.
 * Handles music vs video, auto-extension resolution, and mux container selection.
 */
export function resolveVideoFilename(videoData: VideoData, options: Options, titleOverride?: string) {
  const videoFormat = videoData.videoFormats[0] ?? null;
  const audioFormat = videoData.audioFormats[0] ?? null;
  const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
  const defaultFormat = videoData.isMusic ? audioFormat : videoFormat;
  const resolvedExtension = resolveAutoExtension(extPref, defaultFormat?.mimeType ?? "", videoData.isMusic ? DownloadType.Audio : DownloadType.Video);
  const outputExtension = videoFormat && audioFormat && !videoData.isMusic
    ? getOutputExtension(videoFormat.mimeType, audioFormat.mimeType, resolvedExtension)
    : resolvedExtension;
  const title = titleOverride ?? videoData.title;
  return getCompatibleFilename(`${title}.${outputExtension}`);
}
