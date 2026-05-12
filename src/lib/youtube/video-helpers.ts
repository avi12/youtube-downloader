import { AUTO_EXTENSION } from "@/lib/utils/containers";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import {
  AudioTrackLanguageMode,
  CaptionLanguageMode,
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
  audioTrackLanguageMode: AudioTrackLanguageMode.OriginalLanguage,
  captionLanguageMode: CaptionLanguageMode.SameAsAudio,
  customLanguage: "en",
  downloadExtras: true
};

const CAPTION_TO_AUDIO_MODE: Partial<Record<CaptionLanguageMode, AudioTrackLanguageMode>> = {
  [CaptionLanguageMode.OriginalLanguage]: AudioTrackLanguageMode.OriginalLanguage,
  [CaptionLanguageMode.MatchVideo]: AudioTrackLanguageMode.MatchVideo,
  [CaptionLanguageMode.MatchYouTube]: AudioTrackLanguageMode.MatchYouTube,
  [CaptionLanguageMode.Custom]: AudioTrackLanguageMode.Custom
};

export function resolveCaptionLanguageMode(captionMode: CaptionLanguageMode, audioMode: AudioTrackLanguageMode) {
  return CAPTION_TO_AUDIO_MODE[captionMode] ?? audioMode;
}

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

export function normalizeLanguageCode(lang: string) {
  return lang.split("-")[0].split(".")[0].toLowerCase();
}

export function getCurrentVideoAudioLanguage(): string | null {
  const elVideo = document.querySelector<HTMLVideoElement>("video.html5-main-video");
  const tracks = elVideo?.audioTracks;
  if (!tracks?.length) {
    return null;
  }

  for (const track of tracks) {
    if (track.enabled) {
      return normalizeLanguageCode(track.language);
    }
  }

  return null;
}

function matchAudioFormatToLanguage(audioFormats: AdaptiveFormatItem[], langCode: string) {
  return audioFormats.find(format => normalizeLanguageCode(format.audioTrack?.id ?? "") === langCode);
}

export function findOriginalAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  // Formats without audioTrack are single baked-in tracks
  const noTrack = audioFormats.find(format => !format.audioTrack);
  if (noTrack) {
    return noTrack;
  }

  // YouTube's InnerTube API marks the creator's original track with a ".4" id suffix
  // (AUDIO_TRACK_TYPE_ORIGINAL); dubbed tracks use ".3". This is locale-independent,
  // unlike displayName which is localized and audioIsDefault which reflects the
  // player's current language selection rather than the creator's original.
  return audioFormats.find(format => format.audioTrack?.id.endsWith(".4"))
    ?? audioFormats.find(format => format.audioTrack?.displayName.includes("(original)"))
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? null;
}

export function selectPreferredAudioFormat({
  audioFormats,
  videoMimeType,
  languageMode,
  locale,
  browserLanguage,
  customLanguage
}: {
  audioFormats: AdaptiveFormatItem[];
  videoMimeType: string;
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
  customLanguage?: string;
}) {
  if (!audioFormats.length) {
    return null;
  }

  const isWebm = videoMimeType.includes("webm");
  const originalTrack = findOriginalAudioFormat(audioFormats);

  let candidates: AdaptiveFormatItem[] = [];
  if (languageMode === AudioTrackLanguageMode.Custom && customLanguage) {
    const langCode = normalizeLanguageCode(customLanguage);
    const match = matchAudioFormatToLanguage(audioFormats, langCode)
      ?? matchAudioFormatToLanguage(audioFormats, "en");
    if (match) {
      candidates = [match, ...audioFormats.filter(format => format !== match)];
    }
  } else if (languageMode === AudioTrackLanguageMode.OriginalLanguage) {
    if (originalTrack) {
      candidates = [originalTrack, ...audioFormats.filter(format => format !== originalTrack)];
    }
  }

  if (!candidates.length) {
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
    candidates = originalTrack
      ? [originalTrack, ...audioFormats.filter(format => format !== originalTrack)]
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
  browserLanguage,
  customLanguage
}: {
  captionTracks: CaptionTrack[];
  languageMode: AudioTrackLanguageMode;
  locale: string;
  browserLanguage?: string;
  customLanguage?: string;
}) {
  if (captionTracks.length <= 1 || languageMode === AudioTrackLanguageMode.OriginalLanguage) {
    return captionTracks;
  }

  const firstLang = languageMode === AudioTrackLanguageMode.Custom && customLanguage
    ? normalizeLanguageCode(customLanguage)
    : null;
  const langPriority = [firstLang, locale, browserLanguage, "en"]
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
