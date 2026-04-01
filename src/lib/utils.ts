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

export const extensionToMimeAll: Record<string, string> = {
  aac: "audio/aac",
  aif: "audio/x-aiff",
  aifc: "audio/x-aiff",
  aiff: "audio/x-aiff",
  au: "audio/basic",
  avi: "video/x-msvideo",
  m3u: "audio/x-mpegurl",
  m4a: "audio/mp4",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  ogm: "audio/ogg",
  ogv: "video/ogg",
  opus: "audio/opus",
  ra: "audio/vnd.rn-realaudio",
  ram: "audio/vnd.rn-realaudio",
  snd: "audio/basic",
  spx: "audio/ogg",
  ts: "video/mp2t",
  wav: "audio/vnd.wav",
  weba: "audio/webm",
  webm: "video/webm",
  wmv: "video/x-ms-wmv",
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp"
};

export const extensionToMime: { video: Record<string, string>; audio: Record<string, string> } = {
  video: Object.fromEntries(
    Object.entries(extensionToMimeAll).filter(([, mimeType]) =>
      mimeType.startsWith("video")
    )
  ),
  audio: Object.fromEntries(
    Object.entries(extensionToMimeAll).filter(([, mimeType]) =>
      mimeType.startsWith("audio")
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

// ─── Video quality utilities ──────────────────────────────────────────────────

export const videoQualities = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

export const defaultVideoQuality = 1080;

export const initialOptions: Options = {
  ext: { audio: "mp3", video: "mp4" },
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
  return (
    videoDetails?.isLive === true ||
    videoDetails?.isLiveContent === true ||
    microformat?.playerMicroformatRenderer.liveBroadcastDetails
      ?.isLiveNow === true
  );
}

export function isVideoDownloadable(playerResponse: PlayerResponse) {
  if (isVideoLive(playerResponse)) {
    return false;
  }

  const { status } = playerResponse.playabilityStatus;
  if (status === "LIVE_STREAM_OFFLINE" || status === "LOGIN_REQUIRED" || status === "ERROR") {
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

export function waitForElement(
  selector: string,
  root: Document | Element = document
) {
  const existing = root.querySelector(selector);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise<Element>(resolve => {
    const observer = new MutationObserver(() => {
      const elMatch = root.querySelector(selector);
      if (!elMatch) {
        return;
      }

      observer.disconnect();
      resolve(elMatch);
    });
    observer.observe(
      root instanceof Document ? root.documentElement : root,
      { childList: true, subtree: true }
    );
  });
}

export function waitForVisibleElement(
  selector: string,
  root: Document | Element = document
) {
  function isVisible(elCandidate: HTMLElement) {
    return elCandidate.offsetWidth > 0 && elCandidate.offsetHeight > 0;
  }

  function findVisible() {
    const elements = root.querySelectorAll<HTMLElement>(selector);
    return [...elements].find(isVisible);
  }

  const existing = findVisible();
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise<HTMLElement>(resolve => {
    const observer = new MutationObserver(() => {
      const elMatch = findVisible();
      if (!elMatch) {
        return;
      }

      observer.disconnect();
      resolve(elMatch);
    });
    observer.observe(
      root instanceof Document ? root.documentElement : root,
      { childList: true, subtree: true }
    );
  });
}

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
    observer.observe(document.body, { childList: true, subtree: true });
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
