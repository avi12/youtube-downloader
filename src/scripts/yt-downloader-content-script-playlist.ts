import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import { isElementVisible } from "./utils";
import Vue from "vue/dist/vue.js";
import type { VideoQueue } from "./types";

function appendDownloadContainer({
  videoId,
  elVideoItem
}: {
  videoId: string;
  elVideoItem: Element;
}) {
  const elDownloadContainer = document.createElement("div");
  elDownloadContainer.dataset.ytdlDownloadContainer = videoId;
  elVideoItem.append(elDownloadContainer);
}

// function appendCheckbox({
//   videoId,
//   elVideoNumberContainer
// }: {
//   videoId: string;
//   elVideoNumberContainer: Element;
// }) {
//   const elCheckboxContainer = document.createElement("div");
//   elCheckboxContainer.className = "ytdl-playlist-checkbox-container";
//   elCheckboxContainer.style.width = "0";
//   elCheckboxContainer.innerHTML = `<input type="checkbox" data-ytdl-playlist-checkbox="${videoId}" />`;
//   elVideoNumberContainer.append(elCheckboxContainer);
//
//   setTimeout(() => {
//     elCheckboxContainer.style.width = "31px";
//   }, 500);
// }

export async function handlePlaylist(): Promise<void> {
  const urlVideos = [...document.querySelectorAll("#video-title")].reduce(
    (urls, elTitle: HTMLAnchorElement) => {
      if (elTitle.offsetWidth > 0 && elTitle.offsetHeight > 0) {
        urls.push(elTitle.href);
      }
      return urls;
    },
    []
  );

  const promiseHtmls = urlVideos.map(async url => {
    const abortController = new AbortController();
    gCancelControllers.push(abortController);
    const response = await fetch(url, { signal: abortController.signal });
    return response.text();
  });

  const elVideoItems = [...document.querySelectorAll("#meta")].filter(
    isElementVisible
  );
  // const elVideoNumbersContainers =
  //   document.querySelectorAll("#index-container");

  const downloadContainers: { [videoId: string]: Vue } = {};

  const videoIds: string[] = [];

  for (let i = 0; i < elVideoItems.length; i++) {
    const videoData = await getVideoData(await promiseHtmls[i]);
    if (!getIsDownloadable(videoData)) {
      continue;
    }

    const { videoId } = videoData.videoDetails;
    videoIds.push(videoId);

    // appendCheckbox({
    //   videoId,
    //   elVideoNumberContainer: elVideoNumbersContainers[i]
    // });
    appendDownloadContainer({
      videoId,
      elVideoItem: elVideoItems[i]
    });

    downloadContainers[videoId] = new Vue({
      el: `[data-ytdl-download-container="${videoId}"]`,
      data: {
        isStartedDownload: false,
        isDownloadable: getIsDownloadable(videoData),
        progress: 0,
        isQueued: false
      },
      template: `
        <section class="ytdl-container">
        <div style="display: inline-block;">
          <button @click="toggleDownload" :disabled="!isDownloadable">{{ textButton }}</button>
        </div>
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
        formatsSorted() {
          return videoData.streamingData.adaptiveFormats.sort(
            (a, b) => b.bitrate - a.bitrate
          );
        },
        videoBest() {
          return this.formatsSorted.find(format =>
            format.mimeType.startsWith("video")
          );
        },
        audioBest() {
          return this.formatsSorted.find(format =>
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
              videoIdsToCancel: [videoId]
            });
            return;
          }

          await this.download();
        },
        async download() {
          gPorts.processMedia.postMessage({
            type: "video+audio",
            urls: {
              video: this.videoBest.url,
              audio: this.audioBest.url
            },
            filenameOutput: `${videoData.videoDetails.title}.mp4`,
            videoId,
            isOverride: true
          });
        }
      }
    });
  }

  chrome.runtime.onMessage.addListener(({ updateProgress }) => {
    if (!updateProgress) {
      return;
    }

    const { videoId, progress } = updateProgress;

    if (!downloadContainers[videoId]) {
      return;
    }

    downloadContainers[videoId].progress = progress;

    if (progress === 1) {
      downloadContainers[videoId].isStartedDownload = 0;
      downloadContainers[videoId].isQueued = false;
    }
  });

  chrome.storage.onChanged.addListener(changes => {
    const videoQueue = changes.videoQueue?.newValue as VideoQueue;
    if (!videoQueue) {
      return;
    }

    videoQueue.forEach((videoId, i) => {
      const downloadContainer = downloadContainers[videoId];
      if (!downloadContainer) {
        return;
      }
      downloadContainer.isQueued = i > 0;
      downloadContainer.isStartedDownload = !downloadContainer.isQueued;
      downloadContainer.progress = 0;
    });
  });
  gPorts.main.postMessage({
    action: "insert-playlist-videos",
    videoIds
  });
}
