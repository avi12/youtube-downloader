import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { waitForVideoElement } from "@/lib/youtube/video-helpers";
import { VideoQualityMode, type AdaptiveFormatItem, type VideoData } from "@/types";

export function createVideoFormatTracker({
  getVideoData,
  setSelectedVideoFormat
}: {
  getVideoData: () => VideoData;
  setSelectedVideoFormat: (value: AdaptiveFormatItem | null) => void;
}) {
  async function matchToCurrentQuality(signal: AbortSignal) {
    const videoData = getVideoData();
    try {
      const elVideo = await waitForVideoElement(signal);
      if (document.getElementById("movie_player")?.classList.contains("ytp-ad-playing")) {
        setSelectedVideoFormat(videoData.videoFormats[0] ?? null);
        return;
      }

      const currentQuality = Math.min(elVideo.videoHeight, elVideo.videoWidth);
      setSelectedVideoFormat(
        videoData.videoFormats.find(format => Math.min(format.height ?? 0, format.width ?? 0) === currentQuality)
        ?? videoData.videoFormats[0]
        ?? null
      );
    } catch {
      setSelectedVideoFormat(videoData.videoFormats[0] ?? null);
    }
  }

  $effect(() => {
    const options = CONTENT_OPTIONS;
    const videoData = getVideoData();
    const isCurrentQualityMode = options.videoQualityMode === VideoQualityMode.CurrentQuality;
    if (isCurrentQualityMode) {
      const abortController = new AbortController();
      void matchToCurrentQuality(abortController.signal);
      const elVideo = document.querySelector("video");
      function onCanPlay() {
        void matchToCurrentQuality(abortController.signal);
      }
      elVideo?.addEventListener("canplay", onCanPlay);
      return () => {
        abortController.abort();
        elVideo?.removeEventListener("canplay", onCanPlay);
      };
    }

    const isBestQualityMode = options.videoQualityMode === VideoQualityMode.Best;
    if (isBestQualityMode) {
      setSelectedVideoFormat(videoData.videoFormats[0] ?? null);
      return;
    }

    setSelectedVideoFormat(
      videoData.videoFormats.find(format => format.height === options.videoQuality)
      ?? videoData.videoFormats[0]
      ?? null
    );
  });
}
