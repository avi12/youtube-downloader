import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import Vue from "vue/dist/vue.js";
import { getElementEventually } from "./utils";
import type { VideoQueue } from "./types";

export async function handleVideo(): Promise<void> {
  const getHtml = async () => {
    const abortController = new AbortController();
    gCancelControllers.push(abortController);
    const response = await fetch(location.href, {
      signal: abortController.signal
    });
    return response.text();
  };

  const videoData = await getVideoData(await getHtml());

  const elDownloaderContainer = document.createElement("div");
  elDownloaderContainer.id = "ytdl-download-container";

  const elButtonAfterRating = await getElementEventually(
    "#top-level-buttons-computed ytd-button-renderer"
  );
  elButtonAfterRating.parentElement.insertBefore(
    elDownloaderContainer,
    elButtonAfterRating
  );

  const {
    videoDetails,
    streamingData: { adaptiveFormats }
  } = videoData;

  const formatsSorted = adaptiveFormats.sort((a, b) => b.bitrate - a.bitrate);

  new Vue({
    el: `#${elDownloaderContainer.id}`,
    data: {
      isStartedDownload: false,
      isDownloadable: getIsDownloadable(videoData),
      progress: 0,
      isQueued: false
    },
    template: `
      <section class="ytdl-container">
      <button @click="toggleDownload" :disabled="!isDownloadable">{{ textButton }}</button>
      <progress :value="progress"></progress>
      </section>
    `,
    computed: {
      textButton() {
        if (!this.isDownloadable) {
          return "NOT DOWNLOADABLE";
        }
        if (this.progress === 1) {
          return "DONE";
        }
        if (this.isQueued) {
          return "QUEUED";
        }
        if (this.isStartedDownload) {
          return "CANCEL";
        }
        return "DOWNLOAD";
      },
      videoQuality() {
        const { videoHeight, videoWidth } = document.querySelector("video");
        return Math.min(videoHeight, videoWidth);
      },
      video() {
        return formatsSorted.find(
          format =>
            format.mimeType.startsWith("video") &&
            format.height === this.videoQuality
        );
      },
      audioBest() {
        return formatsSorted.find(format =>
          format.mimeType.startsWith("audio")
        );
      }
    },
    methods: {
      async toggleDownload() {
        this.isStartedDownload = !this.isStartedDownload;

        this.progress = 0;
        if (!this.isStartedDownload) {
          chrome.runtime.sendMessage({
            action: "cancel-download",
            videoIdsToCancel: [videoData.videoDetails.videoId]
          });
          return;
        }

        await this.download();
      },
      async download() {
        gPorts.processMedia.postMessage({
          type: "video+audio",
          urls: {
            video: this.video.url,
            audio: this.audioBest.url
          },
          filenameOutput: `${videoDetails.title}.mp4`,
          videoId: videoDetails.videoId
        });
      }
    },
    created() {
      chrome.runtime.onMessage.addListener(({ updateProgress }) => {
        if (!updateProgress) {
          return;
        }
        const { videoId, progress } = updateProgress;
        if (videoId !== videoData.videoDetails.videoId) {
          return;
        }
        this.progress = progress;
        if (progress === 1) {
          this.isStartedDownload = false;
          this.isQueued = false;
        }
      });

      chrome.storage.onChanged.addListener(changes => {
        const videoQueue = changes.videoQueue?.newValue as VideoQueue;
        if (!videoQueue) {
          return;
        }

        const { videoId } = videoData.videoDetails;
        const isQueued = videoQueue.includes(videoId);
        const isCurrentlyInDownload = videoQueue[0] === videoId;

        this.isQueued = isQueued && !isCurrentlyInDownload;
      });
    }
  });
}
