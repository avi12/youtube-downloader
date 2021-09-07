import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import Vue from "vue/dist/vue.min.js";
import { getElementEventually } from "./utils";
import type { AdaptiveFormatItem, VideoQueue } from "./types";

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

  if (document.getElementById(elDownloaderContainer.id)) {
    return;
  }

  elButtonAfterRating.parentElement.insertBefore(
    elDownloaderContainer,
    elButtonAfterRating
  );

  const { videoId, title } = videoData.videoDetails;

  const isMusic =
    videoData.microformat.playerMicroformatRenderer.category === "Music";
  const ext = isMusic ? "mp3" : "mp4";

  new Vue({
    el: `#${elDownloaderContainer.id}`,
    data: {
      isStartedDownload: false,
      isDownloadable: getIsDownloadable(videoData),
      progress: 0,
      progressType: "",
      isQueued: false,
      isPortDisconnected: false,
      downloadType: isMusic ? "audio" : "video+audio",
      filenameOutput: `${title}.${ext}`
    },
    template: `
      <section class="ytdl-container" id="${elDownloaderContainer.id}">
      <button @click="toggleDownload" :disabled="!isDownloadable">{{ textButton }}</button>
      <!--suppress HtmlUnknownAttribute -->
      <progress :value="progress" :data-progress-type="progressType"></progress>
      </section>
    `,
    computed: {
      textButton() {
        if (this.isPortDisconnected) {
          return "RELOAD TO DOWNLOAD";
        }
        if (!this.isDownloadable) {
          return "NOT DOWNLOADABLE";
        }
        if (
          this.progress === 1 &&
          (this.progressType === "ffmpeg" ||
            this.downloadType !== "video+audio")
        ) {
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
      formatsSorted() {
        return videoData.streamingData.adaptiveFormats.sort(
          (a, b) => b.bitrate - a.bitrate
        );
      },
      videoQuality() {
        const { videoHeight, videoWidth } = document.querySelector("video");
        return Math.min(videoHeight, videoWidth);
      },
      video() {
        return this.formatsSorted.find(
          format =>
            format.mimeType.startsWith("video") &&
            format.height === this.videoQuality
        );
      },
      audioBest(): AdaptiveFormatItem {
        return this.formatsSorted.find(format =>
          format.mimeType.startsWith("audio")
        );
      }
    },
    methods: {
      async toggleDownload() {
        this.isStartedDownload = !this.isStartedDownload;

        this.progress = 0;
        if (!this.isStartedDownload || this.isQueued) {
          chrome.runtime.sendMessage({
            action: "cancel-download",
            videoIdsToCancel: [videoId]
          });
          return;
        }

        await this.download();
      },
      async download() {
        gPorts.processSingle.postMessage({
          type: this.downloadType,
          urls: {
            video: this.video.url,
            audio: this.audioBest.url
          },
          filenameOutput: this.filenameOutput,
          videoId
        });
      }
    },
    created() {
      chrome.runtime.onMessage.addListener(
        ({ updateProgress: { progress, progressType, isRemoved } }) => {
          if (isRemoved) {
            this.progress = 0;
            this.progressType =
              this.downloadType === "video+audio"
                ? "ffmpeg"
                : this.downloadType;
            this.isStartedDownload = false;
            this.isQueued = false;
            return;
          }

          this.progress = progress;
          this.progressType = progressType;
          this.isStartedDownload = progress > 0 && progress < 1;
        }
      );

      chrome.storage.onChanged.addListener(changes => {
        const videoQueue = changes.videoQueue?.newValue as VideoQueue;
        if (videoQueue) {
          const { videoId } = videoData.videoDetails;
          const isInQueue = videoQueue.includes(videoId);
          const isDownloading = videoQueue[0] === videoId;
          this.isQueued = isInQueue && !isDownloading;
          if (isDownloading) {
            this.progress = 0;
          }
          this.isStartedDownload = isDownloading;
          return;
        }
      });

      gPorts.main.onDisconnect.addListener(() => {
        this.isPortDisconnected = true;
        this.isDownloadable = false;
      });
    }
  });
}
