import { PlaylistDownloadMode, PlaylistOutputMode, ProgressType, VideoQualityMode } from "@/types";
import type { AdaptiveFormatItem, Options, PlayerResponse } from "@/types";
import { PlayabilityStatus } from "@/types/youtube";
import { AUTO_EXTENSION } from "~/lib/utils/containers";
import { CHILD_LIST_SUBTREE } from "~/lib/utils/dom";

export const videoQualities = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

const DEFAULT_VIDEO_QUALITY = 1080;

export const initialOptions: Options = {
  ext: {
    audio: AUTO_EXTENSION,
    video: AUTO_EXTENSION
  },
  defaultDownloadType: "auto",
  videoQualityMode: VideoQualityMode.Best,
  videoQuality: DEFAULT_VIDEO_QUALITY,
  isShowNativeDownload: false,
  playlistDownloadMode: PlaylistDownloadMode.Fast,
  playlistOutputMode: PlaylistOutputMode.Individual,
  playlistAudioOutputMode: PlaylistOutputMode.Zip,
  isPlaylistScrollSyncEnabled: false
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
