import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  gPorts
} from "./yt-downloader-content-script-initialize";
import type { PlayerResponse } from "./types";
import Vue from "vue/dist/vue.js";
import { getElementEventually } from "./utils";

export async function handleVideo(): Promise<void> {
  const getHtml = async () => {
    const abortController = new AbortController();
    gCancelControllers.push(abortController);
    const response = await fetch(location.href, {
      signal: abortController.signal
    });
    return response.text();
  };

  window.videoData = await getVideoData(await getHtml());

  const getIsLive = (videoDataRaw: PlayerResponse) =>
    videoDataRaw.microformat?.playerMicroformatRenderer.liveBroadcastDetails
      ?.isLiveNow;

  const elDownloaderContainer = document.createElement("div");
  elDownloaderContainer.id = "ytdl-download-container";

  const elButtonAfterRating = await getElementEventually(
    "#top-level-buttons-computed ytd-button-renderer"
  );
  elButtonAfterRating.parentElement.insertBefore(
    elDownloaderContainer,
    elButtonAfterRating
  );

  const downloadContainer = new Vue({
    el: "#ytdl-download-container",
    data: {
      isStartedDownload: false,
      isDownloadable: !getIsLive(window.videoData),
      progress: 0,
      isQueued: false
    },
    template: `
      <section>
      <button @click="toggleDownload" :disabled="!isDownloadable">{{ textButton }}</button>
      <progress :value="progress"></progress>
      </section>
    `,
    computed: {
      textButton() {
        if (!this.isDownloadable) {
          return "NOT DOWNLOADABLE";
        }
        if (!this.isStartedDownload) {
          return "DOWNLOAD";
        }
        if (this.isQueued) {
          return "QUEUED";
        }
        return "CANCEL";
      }
    },
    methods: {
      toggleDownload() {
        this.isStartedDownload = !this.isStartedDownload;

        if (!this.isStartedDownload) {
          gPorts.main.postMessage({ action: "cancel-download" });
          return;
        }

        const { videoHeight, videoWidth } = document.querySelector("video");
        const videoQuality = Math.min(videoHeight, videoWidth);

        const {
          videoDetails,
          streamingData: { adaptiveFormats }
        } = window.videoData;

        const formatsSorted = adaptiveFormats.sort(
          (a, b) => b.bitrate - a.bitrate
        );
        const video = formatsSorted.find(
          format =>
            format.mimeType.startsWith("video") &&
            format.height === videoQuality
        );

        const audioBest = formatsSorted.find(format =>
          format.mimeType.startsWith("audio")
        );

        gPorts.processMedia.postMessage({
          type: "video+audio",
          urls: {
            video: video.url,
            audio: audioBest.url
          },
          filenameOutput: `${videoDetails.title}.mp4`,
          videoId: videoDetails.videoId
        });
      }
    }
  });

  gPorts.processMedia.onMessage.addListener(({ progress }) => {
    downloadContainer.progress = progress;
    if (progress === 100) {
      downloadContainer.isStartedDownload = false;
    }
  });

  chrome.storage.onChanged.addListener(({ tracker }) => {
    if (!tracker?.newValue.videoQueue) {
      return;
    }

    const { videoId } = window.videoData.videoDetails;
    const isQueued = tracker.newValue.videoQueue.includes(videoId);
    const isCurrentlyInDownload = tracker.newValue.videoQueue[0] === videoId;
    if (!isQueued) {
      return;
    }
    downloadContainer.isQueued = isQueued && !isCurrentlyInDownload;
    downloadContainer.isStartedDownload = isCurrentlyInDownload;
  });
}
