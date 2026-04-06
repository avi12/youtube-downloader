import type { Options, PlayerResponse } from "../types";

// ─── Filename utilities ───────────────────────────────────────────────────────

export function getCompatibleFilename(filename: string) {
  // Remove characters forbidden on any OS: < > : " \ / | ? *
  // Also remove single quotes and backticks which break FFmpeg WASM arg parsing
  const universalForbidden = /[<>:"'\\/|?*`]/g;
  return filename.replace(universalForbidden, "");
}

export function getFileExtension(filename: string) {
  return filename.split(".").pop() ?? "";
}

// ─── MIME types ───────────────────────────────────────────────────────────────

// Only containers that FFmpeg can remux YouTube streams into with -c copy.
// YouTube produces H.264/VP9/AV1 video and AAC/Opus/Vorbis audio.
export const extensionToMimeAll: Record<string, string> = {
  m4a: "audio/mp4",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  opus: "audio/opus",
  weba: "audio/webm",
  webm: "video/webm"
};

export const extensionToMime: { video: Record<string, string>;
  audio: Record<string, string>; } = {
  video: Object.fromEntries(
    Object.entries(extensionToMimeAll).filter(([, mimeType]) => {
      return mimeType.startsWith("video");
    }
    )
  ),
  audio: Object.fromEntries(
    Object.entries(extensionToMimeAll).filter(([, mimeType]) => {
      return mimeType.startsWith("audio");
    }
    )
  )
};

export const supportedExtensions = {
  video: Object.keys(extensionToMime.video),
  audio: Object.keys(extensionToMime.audio)
};

export function getMimeType(filename: string) {
  return extensionToMimeAll[getFileExtension(filename)];
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

export const defaultVideoQuality = 1080;

export const initialOptions: Options = {
  ext: {
    audio: "mp3",
    video: "mp4"
  },
  videoQualityMode: "current-quality",
  videoQuality: defaultVideoQuality,
  isRemoveNativeDownload: false
};

// ─── YouTube utilities ────────────────────────────────────────────────────────

export function getVideoIdFromUrl(url: string) {
  try {
    const { search } = new URL(url);
    return new URLSearchParams(search).get("v");
  } catch {
    return null;
  }
}

export function isVideoLive(playerResponse: PlayerResponse) {
  const { videoDetails, microformat } = playerResponse;
  // isLive and isLiveNow indicate currently live. isLiveContent means
  // "this was/is live content" which includes past live streams that
  // are downloadable, so we must NOT check it here.
  return (
    videoDetails?.isLive === true ||
    microformat?.playerMicroformatRenderer.liveBroadcastDetails
      ?.isLiveNow === true
  );
}

export function isVideoDownloadable(playerResponse: PlayerResponse) {
  if (isVideoLive(playerResponse)) {
    return false;
  }

  const { status } = playerResponse.playabilityStatus;
  if (status === "LOGIN_REQUIRED" || status === "ERROR") {
    return false;
  }

  const { streamingData } = playerResponse;
  if (!streamingData) {
    return false;
  }

  const formats = streamingData.adaptiveFormats ?? [];
  return formats.some(format => {
    return Boolean(format.url) || Boolean(format.signatureCipher);
  })
    || Boolean(streamingData.serverAbrStreamingUrl);
}

export function isVideoMusic(playerResponse: PlayerResponse) {
  return (
    playerResponse.microformat?.playerMicroformatRenderer.category === "Music"
  );
}

// ─── DOM utilities ────────────────────────────────────────────────────────────

export function waitForVideoElement() {
  return new Promise<HTMLVideoElement>(resolve => {
    const observer = new MutationObserver(() => {
      const elVideo = document.querySelector<HTMLVideoElement>("video");
      if (!elVideo || elVideo.videoHeight === 0) {
        return;
      }

      observer.disconnect();
      resolve(elVideo);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

// ─── Difference utility ───────────────────────────────────────────────────────

export function getOptionDiff(
  newOptions: Options,
  oldOptions: Options
) {
  const result: Partial<Options> = {};
  if (JSON.stringify(newOptions.ext) !== JSON.stringify(oldOptions.ext)) {
    result.ext = newOptions.ext;
  }

  if (newOptions.videoQualityMode !== oldOptions.videoQualityMode) {
    result.videoQualityMode = newOptions.videoQualityMode;
  }

  if (newOptions.videoQuality !== oldOptions.videoQuality) {
    result.videoQuality = newOptions.videoQuality;
  }

  if (newOptions.isRemoveNativeDownload !== oldOptions.isRemoveNativeDownload) {
    result.isRemoveNativeDownload = newOptions.isRemoveNativeDownload;
  }

  return result;
}
