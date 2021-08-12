import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  gPorts
} from "./yt-downloader-content-script-initialize";
import type { PlayerResponse, Tracker } from "./types";
import Vue from "vue/dist/vue.js";
import { getElementEventually, getStorage } from "./utils";
import StorageChange = chrome.storage.StorageChange;

let downloadContainer;

function updateDownloadStatus(changes: { [key: string]: StorageChange }) {
  const tracker = changes.tracker?.newValue as Tracker;
  if (!tracker) {
    return;
  }

  const { videoId } = window.videoData.videoDetails;
  const isQueued = tracker.videoQueue.includes(videoId);
  const isCurrentlyInDownload = tracker.videoQueue[0] === videoId;

  downloadContainer.isQueued = isQueued && !isCurrentlyInDownload;
  downloadContainer.isStartedDownload = isCurrentlyInDownload;
}

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

  const {
    videoDetails,
    streamingData: { adaptiveFormats }
  } = window.videoData;

  const formatsSorted = adaptiveFormats.sort((a, b) => b.bitrate - a.bitrate);

  downloadContainer = new Vue({
    el: "#ytdl-download-container",
    data: {
      isStartedDownload: false,
      progress: 0,
      isQueued: false
    },
    template: `
      <section style="display: flex; flex-direction: column; justify-content: center;">
      <button @click="toggleDownload" :disabled="!isDownloadable">{{ textButton }}</button>
      <progress :value="progress"></progress>
      </section>
    `,
    computed: {
      textButton() {
        if (!this.isDownloadable) {
          return "NOT DOWNLOADABLE";
        }
        if (this.isStartedDownload) {
          return "CANCEL";
        }
        if (this.isQueued) {
          return "QUEUED";
        }
        if (this.progress === 1) {
          return "DONE";
        }
        return "DOWNLOAD";
      },
      isDownloadable() {
        return !getIsLive(window.videoData);
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
      async toggleDownload({ ctrlKey }: MouseEvent) {
        this.isStartedDownload = !this.isStartedDownload;

        if (!this.isStartedDownload) {
          gPorts.main.postMessage({ action: "cancel-download" });
          return;
        }

        const tracker = (await getStorage("local", "tracker")) as Tracker;
        const isADownloadInProgress = tracker.videoQueue.length > 0;
        if (isADownloadInProgress && ctrlKey) {
          gPorts.main.postMessage({ action: "cancel-download" });
          await this.download();
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
    }
  });

  gPorts.processMedia.onMessage.addListener(({ progress }) => {
    downloadContainer.progress = progress;
    if (progress === 100) {
      downloadContainer.isStartedDownload = false;
    }
  });

  chrome.storage.onChanged.removeListener(updateDownloadStatus);
  chrome.storage.onChanged.addListener(updateDownloadStatus);
}
