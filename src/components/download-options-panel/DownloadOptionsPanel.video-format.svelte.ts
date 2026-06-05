import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { filterVideoFormatsByEnhancedBitrate } from "@/lib/youtube/format-display";
import { waitForVideoElement } from "@/lib/youtube/video-helpers";
import { VideoQualityMode, type AdaptiveFormatItem, type Prettify, type VideoData } from "@/types";
import { untrack } from "svelte";

const MOVIE_PLAYER_ID = "movie_player";
const YTP_AD_PLAYING_CLASS = "ytp-ad-playing";
const VIDEO_CAN_PLAY_EVENT = "canplay";

type CreateVideoFormatTrackerParams = Prettify<{
  getVideoData: () => VideoData;
  setSelectedVideoFormat: (value: AdaptiveFormatItem | null) => void;
  isDownloading: () => boolean;
}>;
export function createVideoFormatTracker({
  getVideoData,
  setSelectedVideoFormat,
  isDownloading
}: CreateVideoFormatTrackerParams) {
  async function matchToCurrentQuality(signal: AbortSignal) {
    const videoData = getVideoData();
    const candidates = filterVideoFormatsByEnhancedBitrate(videoData.videoFormats, CONTENT_OPTIONS.enhancedBitrate);
    try {
      const elVideo = await waitForVideoElement(signal);
      const isAdPlaying = document.getElementById(MOVIE_PLAYER_ID)?.classList.contains(YTP_AD_PLAYING_CLASS);
      if (isAdPlaying) {
        setSelectedVideoFormat(candidates[0] ?? null);
        return;
      }

      const currentQuality = Math.min(elVideo.videoHeight, elVideo.videoWidth);
      const matchingFormat = candidates.find(
        format => Math.min(format.height ?? 0, format.width ?? 0) === currentQuality
      );
      setSelectedVideoFormat(matchingFormat ?? candidates[0] ?? null);
    } catch {
      setSelectedVideoFormat(candidates[0] ?? null);
    }
  }

  $effect(() => {
    const options = CONTENT_OPTIONS;
    const videoData = getVideoData();
    if (untrack(isDownloading)) {
      return;
    }

    const candidates = filterVideoFormatsByEnhancedBitrate(videoData.videoFormats, options.enhancedBitrate);
    const isCurrentQualityMode = options.videoQualityMode === VideoQualityMode.CurrentQuality;
    if (isCurrentQualityMode) {
      const abortController = new AbortController();
      void matchToCurrentQuality(abortController.signal);
      const elVideo = document.querySelector("video");
      function handleCanPlay() {
        void matchToCurrentQuality(abortController.signal);
      }
      elVideo?.addEventListener(VIDEO_CAN_PLAY_EVENT, handleCanPlay);
      return () => {
        abortController.abort();
        elVideo?.removeEventListener(VIDEO_CAN_PLAY_EVENT, handleCanPlay);
      };
    }

    const isBestQualityMode = options.videoQualityMode === VideoQualityMode.Best;
    if (isBestQualityMode) {
      setSelectedVideoFormat(candidates[0] ?? null);
      return;
    }

    const matchingFormat = candidates.find(format => format.height === options.videoQuality);
    setSelectedVideoFormat(matchingFormat ?? candidates[0] ?? null);
  });
}
