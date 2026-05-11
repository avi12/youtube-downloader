import { AUTO_EXTENSION } from "@/lib/utils/containers";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import {
  AudioTrackLanguageMode,
  DownloadType,
  PlaylistDownloadMode,
  PlaylistOutputMode,
  ProgressType,
  VideoQualityMode
} from "@/types";
import type {
  AdaptiveFormatItem,
  CaptionTrack,
  Options,
  PlayerResponse,
  SabrConfig
} from "@/types";
import { PlayabilityStatus } from "@/types/youtube";

export const VIDEO_QUALITIES = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

const DEFAULT_VIDEO_QUALITY = 1080;

export const INITIAL_OPTIONS: Options = {
  ext: {
    audio: AUTO_EXTENSION,
    video: "mkv"
  },
  defaultDownloadType: DownloadType.Auto,
  videoQualityMode: VideoQualityMode.Best,
  videoQuality: DEFAULT_VIDEO_QUALITY,
  isShowNativeDownload: false,
  isNotifyOnIdle: false,
  isRevealOnComplete: false,
  playlistDownloadMode: PlaylistDownloadMode.Fast,
  playlistOutputMode: PlaylistOutputMode.Individual,
  playlistAudioOutputMode: PlaylistOutputMode.Zip,
  isPlaylistScrollSyncEnabled: false,
  audioTrackLanguageMode: AudioTrackLanguageMode.MatchYouTube
};

export function isVideoLive(playerResponse: PlayerResponse) {
  // isLiveContent also matches past-live VODs (which are downloadable), so don't read it here.
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
  return playerResponse.microformat?.playerMicroformatRenderer.category === "Music";
}

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

    observer.observe(document.body, CHILD_LIST_SUBTREE);

    signal?.addEventListener("abort", () => {
      observer.disconnect();
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

export function formatVideoQualityLabel(format: Pick<AdaptiveFormatItem, "height" | "fps" | "qualityLabel">) {
  const base = `${format.height}p${format.fps ? ` ${format.fps}fps` : ""}`;
  const isPremium = (format.qualityLabel ?? "").includes("Premium");
  return isPremium ? `${base} (Enhanced)` : base;
}

export function formatAudioCodecLabel(mimeType: string) {
  const [, codec = ""] = mimeType.match(/codecs="([^"]+)"/) ?? [];
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

function normalizeLanguageCode(lang: string) {
  return lang.split("-")[0].split(".")[0].toLowerCase();
}

function matchAudioFormatToLanguage(audioFormats: AdaptiveFormatItem[], langCode: string) {
  return audioFormats.find(format => normalizeLanguageCode(format.audioTrack?.id ?? "") === langCode);
}

export function selectPreferredAudioFormat({
  audioFormats,
  videoMimeType,
  languageMode,
  locale,
  browserLanguage
}: {
  audioFormats: AdaptiveFormatItem[];
  videoMimeType: string;
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
}) {
  if (!audioFormats.length) {
    return null;
  }

  const isWebm = videoMimeType.includes("webm");
  const originalTrack = audioFormats.find(format => !format.audioTrack);

  let candidates: AdaptiveFormatItem[] = [];
  if (languageMode === AudioTrackLanguageMode.MatchYouTube) {
    const langPriority = [locale, browserLanguage, "en"]
      .filter((lang): lang is string => !!lang);
    for (const lang of langPriority) {
      const match = matchAudioFormatToLanguage(audioFormats, normalizeLanguageCode(lang));
      if (match) {
        candidates = [match, ...audioFormats.filter(format => format !== match)];
        break;
      }
    }
  }

  if (!candidates.length) {
    const fallback = originalTrack ?? audioFormats.find(format => format.audioTrack?.audioIsDefault) ?? null;
    candidates = fallback
      ? [fallback, ...audioFormats.filter(format => format !== fallback)]
      : audioFormats;
  }

  if (isWebm) {
    return candidates.find(format => format.mimeType.includes("webm")) ?? candidates[0] ?? null;
  }

  return candidates[0] ?? null;
}

export function orderCaptionsByPreference({
  captionTracks,
  languageMode,
  locale,
  browserLanguage
}: {
  captionTracks: CaptionTrack[];
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
}) {
  if (languageMode === AudioTrackLanguageMode.OriginalLanguage || captionTracks.length <= 1) {
    return captionTracks;
  }

  const langPriority = [locale, browserLanguage, "en"]
    .filter((lang): lang is string => !!lang);
  for (const lang of langPriority) {
    const normalized = normalizeLanguageCode(lang);
    const preferred = captionTracks.filter(track => normalizeLanguageCode(track.languageCode) === normalized);
    if (preferred.length) {
      const rest = captionTracks.filter(track => normalizeLanguageCode(track.languageCode) !== normalized);
      return [...preferred, ...rest];
    }
  }

  return captionTracks;
}

function isUrlExpired(url: string) {
  try {
    const expire = new URL(url).searchParams.get("expire");
    return expire ? Date.now() / 1000 > Number(expire) : false;
  } catch {
    return false;
  }
}

export function isVideoDataExpired(videoData: {
  sabrConfig: SabrConfig | null;
  videoFormats: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
}) {
  const sabrUrl = videoData.sabrConfig?.serverAbrStreamingUrl;
  if (sabrUrl && isUrlExpired(sabrUrl)) {
    return true;
  }

  const formats = [...videoData.videoFormats, ...videoData.audioFormats];
  return formats.slice(0, 3).some(format => format.url && isUrlExpired(format.url));
}

const DOWNLOAD_PHASE_WEIGHT = 70;
const MUX_PHASE_WEIGHT = 30;

export function calculateWeightedProgress({ isDownloading, progress, progressType }: {
  isDownloading: boolean;
  progress: number;
  progressType: ProgressType | "";
}) {
  if (!isDownloading) {
    return 0;
  }

  if (progressType === ProgressType.FFmpeg) {
    return DOWNLOAD_PHASE_WEIGHT + progress * MUX_PHASE_WEIGHT;
  }

  return progress * DOWNLOAD_PHASE_WEIGHT;
}
