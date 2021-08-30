import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import { isElementVisible } from "./utils";
import Vue from "vue/dist/vue.js";
import type { VideoQueue } from "./types";

let downloadContainers: { [videoId: string]: Vue };
let downloadPlaylist: Vue;

function appendDownloadContainer({
  videoId,
  elVideoItem
}: {
  videoId: string;
  elVideoItem: Element;
}) {
  const selector = `data-ytdl-download-container="${videoId}"`;
  if (document.querySelector(`[${selector}]`)) {
    return;
  }

  const elDownloadContainer = document.createElement("div");
  elDownloadContainer.dataset.ytdlDownloadContainer = videoId;
  elVideoItem.append(elDownloadContainer);
}

function appendCheckbox({
  videoId,
  elVideoNumberContainer
}: {
  videoId: string;
  elVideoNumberContainer: Element;
}) {
  if (document.querySelector(`[data-ytdl-playlist-checkbox="${videoId}"]`)) {
    return;
  }
  const elCheckboxContainer = document.createElement("div");
  elCheckboxContainer.className = "ytdl-playlist-checkbox-container";
  elCheckboxContainer.style.width = "0";
  elCheckboxContainer.innerHTML = `<input type="checkbox" data-ytdl-playlist-checkbox="${videoId}" />`;
  elVideoNumberContainer.append(elCheckboxContainer);

  setTimeout(() => {
    elCheckboxContainer.style.width = "31px";
  }, 500);
}

export function appendPlaylistDownloadButton(): void {
  const elDownloadPlaylistContainer = document.querySelector(
    "ytd-playlist-sidebar-primary-info-renderer"
  );

  const elDownloadPlaylist = document.createElement("div");
  elDownloadPlaylist.id = "ytdl-playlist-button-container";

  const isNoVideosAvailable = !document.querySelector("#meta");
  const isButtonAlreadyPlaced = Boolean(
    document.querySelector(`#${elDownloadPlaylist.id}`)
  );
  if (isButtonAlreadyPlaced || isNoVideosAvailable) {
    return;
  }

  elDownloadPlaylistContainer.insertBefore(
    elDownloadPlaylist,
    elDownloadPlaylistContainer.querySelector("#play-buttons")
  );

  downloadPlaylist = new Vue({
    el: `#${elDownloadPlaylist.id}`,
    data: {
      isStartedDownload: false,
      progress: 0,
      error: "",
      isAllChecked: false,
      countVideosToDownload: -1,
      countVideosDownloaded: 0,
      isPortDisconnected: false,
      videoIdsToDownload: [] as string[]
    },
    template: `
      <section id="ytdl-playlist-button-container" style="max-height: 0;" ref="container">
      <button @click="toggleDownload" :disabled="isPortDisconnected">{{ textButton }}</button>
      <button @click="toggleCheckbox" :disabled="isStartedDownload" id="ytdl-toggle-checkbox">TOGGLE ALL</button>
      <transition-group name="slide">
        <div key="count" v-show="isStartedDownload && countVideosToDownload > 0" class="ytdl--size-medium ytdl--text">
          {{ countVideosDownloaded }} out of {{ countVideosToDownload }}
        </div>
        <div key="error" v-show="error" class="ytdl--error ytdl--size-medium">{{ error }}</div>
      </transition-group>
      </section>
    `,
    watch: {
      isAllChecked() {
        this.error = "";
      },
      isStartedDownload(isStarted: boolean) {
        this.elCheckboxes.forEach(
          (elCheckbox: HTMLInputElement) => (elCheckbox.disabled = isStarted)
        );
      },
      countVideosDownloaded(numVideosDownloaded: number) {
        this.isStartedDownload =
          numVideosDownloaded < this.countVideosToDownload;
      },
      countVideosToDownload(numVideosToDownload: number) {
        this.isStartedDownload = numVideosToDownload > 0;
      },
      videoIdsToDownload(videoIds: string[]) {
        this.countVideosToDownload = videoIds.length;
      }
    },
    computed: {
      textButton() {
        if (this.isPortDisconnected) {
          return "RELOAD TO DOWNLOAD";
        }
        if (this.isStartedDownload) {
          return "CANCEL";
        }
        return "DOWNLOAD";
      },
      elCheckboxes() {
        return [...document.querySelectorAll("[data-ytdl-playlist-checkbox]")];
      }
    },
    methods: {
      getVideoIdsToDownload(): string[] {
        return [
          ...document.querySelectorAll("[data-ytdl-playlist-checkbox]:checked")
        ].map(
          (elCheckbox: HTMLInputElement) =>
            elCheckbox.dataset.ytdlPlaylistCheckbox
        );
      },
      getVideoInfosToDownload(): {
        urls: { video: string; audio: string };
        filenameOutput: string;
        videoId: string;
      }[] {
        return this.getVideoIdsToDownload().map(videoId => {
          const downloadContainer = downloadContainers[videoId];
          return {
            type: "video+audio",
            urls: {
              video: downloadContainer.videoBest.url,
              audio: downloadContainer.audioBest.url
            },
            filenameOutput: `${downloadContainer.videoData.videoDetails.title}.mp4`,
            videoId
          };
        });
      },
      async toggleDownload() {
        this.videoIdsToDownload = this.getVideoIdsToDownload();
        const isNoVideosSelected = this.videoIdsToDownload.length === 0;
        if (isNoVideosSelected) {
          this.error = "Select at least one video";
          return;
        }
        this.error = "";

        this.isStartedDownload = !this.isStartedDownload;
        if (!this.isStartedDownload) {
          chrome.runtime.sendMessage({
            action: "cancel-download",
            videoIdsToCancel: this.videoIdsToDownload
          });
          return;
        }

        this.countVideosToDownload = this.videoIdsToDownload.length;
        gPorts.processPlaylist.postMessage(this.getVideoInfosToDownload());
      },
      toggleCheckbox() {
        this.isAllChecked = !this.isAllChecked;
        this.elCheckboxes.forEach(
          (elCheckbox: HTMLInputElement) =>
            (elCheckbox.checked = this.isAllChecked)
        );
      }
    },
    created() {
      setTimeout(() => (this.$refs.container.style.maxHeight = "100px"));

      const elVideosContainer = document.querySelector("#contents");

      new MutationObserver(() => {
        this.countVideosDownloaded = document.querySelectorAll(
          `#contents progress[value="1"][data-progress-type="ffmpeg"]`
        ).length;
      }).observe(elVideosContainer, {
        attributes: true,
        subtree: true,
        attributeFilter: ["value"]
      });

      elVideosContainer.addEventListener("change", (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (!target.matches("[data-ytdl-playlist-checkbox]")) {
          return;
        }

        this.error = "";
      });
    }
  });
}

export async function handlePlaylistVideos(): Promise<void> {
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

  const elVideoNumbersContainers =
    document.querySelectorAll("#index-container");

  const elVideoItems = [...document.querySelectorAll("#meta")].filter(
    isElementVisible
  );

  downloadContainers = {};

  const videoIds: string[] = [];

  for (let i = 0; i < elVideoItems.length; i++) {
    const videoData = await getVideoData(await promiseHtmls[i]);

    const isDownloadable = getIsDownloadable(videoData);
    if (!isDownloadable) {
      continue;
    }

    const { videoId } = videoData.videoDetails;
    if (!videoIds.includes(videoId)) {
      videoIds.push(videoId);
    }

    appendCheckbox({
      videoId,
      elVideoNumberContainer: elVideoNumbersContainers[i]
    });

    appendDownloadContainer({
      videoId,
      elVideoItem: elVideoItems[i]
    });

    downloadContainers[videoId] = new Vue({
      el: `[data-ytdl-download-container="${videoId}"]`,
      data: {
        isStartedDownload: false,
        isDownloadable,
        progress: 0,
        progressType: "",
        isQueued: false,
        videoData,
        isPortDisconnected: false
      },
      template: `
        <section class="ytdl-container" data-ytdl-download-container="${videoId}">
        <div>
          <button @click="toggleDownload" :disabled="!isDownloadable">{{ textButton }}</button>
        </div>
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
          if (this.progress === 1 && this.progressType === "ffmpeg") {
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
          const isQueued =
            downloadPlaylist.videoIdsToDownload.includes(videoId);
          if (!this.isStartedDownload || isQueued) {
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
            type: "video+audio",
            urls: {
              video: this.videoBest.url,
              audio: this.audioBest.url
            },
            filenameOutput: `${this.videoData.videoDetails.title}.mp4`,
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

    const { videoId, progress, progressType } = updateProgress;

    const downloadContainer = downloadContainers[videoId];
    if (!downloadContainer) {
      return;
    }

    downloadContainer.progress = progress;
    downloadContainer.progressType = progressType;
    downloadContainer.isStartedDownload =
      (progress < 1 && progress > 0) || progressType !== "ffmpeg";

    if (progress === 1) {
      downloadContainer.isQueued = false;
    }
  });

  const isIdExists = videoId =>
    downloadPlaylist.videoIdsToDownload.includes(videoId);

  chrome.storage.onChanged.addListener(changes => {
    const videoQueueCurrent = changes.videoQueue?.newValue as VideoQueue;
    if (!videoQueueCurrent) {
      return;
    }

    const videoQueuePlaylistCurrent: VideoQueue =
      videoQueueCurrent.filter(isIdExists);

    const videoQueuePlaylistPrevious: VideoQueue =
      changes.videoQueue.oldValue.filter(isIdExists);

    const videoQueueDiff: VideoQueue = videoQueuePlaylistPrevious.filter(
      videoId => !videoQueuePlaylistCurrent.includes(videoId)
    );

    const isGainedVideoIds =
      videoQueuePlaylistCurrent.length >
      downloadPlaylist.videoIdsToDownload.length;

    if (!isGainedVideoIds && videoQueueDiff.length > 0) {
      downloadPlaylist.videoIdsToDownload =
        downloadPlaylist.videoIdsToDownload.filter(
          videoId => !videoQueueDiff.includes(videoId)
        );
    }

    videoQueueDiff.forEach(videoId => {
      const downloadContainer = downloadContainers[videoId];
      downloadContainer.isStartedDownload = false;
      downloadContainer.isQueued = false;

      const elProgress: HTMLElement = document.querySelector(
        `[data-ytdl-download-container="${videoId}"] progress[data-progress-type]`
      );
      if (
        elProgress.dataset.progressType !== "ffmpeg" ||
        downloadContainer.progress !== 1
      ) {
        downloadContainer.progress = 0;
      }
    });

    videoQueueCurrent.forEach((videoId, i) => {
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

  gPorts.main.onDisconnect.addListener(() => {
    downloadPlaylist.isPortDisconnected = true;
    downloadPlaylist.isDownloadable = false;
    (<HTMLButtonElement>(
      document.querySelector("#ytdl-toggle-checkbox")
    )).disabled = true;

    const elCheckboxes = [
      ...document.querySelectorAll(`[data-ytdl-playlist-checkbox]`)
    ];
    const videoIds = elCheckboxes.map(
      (elCheckbox: HTMLInputElement) => elCheckbox.dataset.ytdlPlaylistCheckbox
    );
    videoIds.forEach(videoId => {
      const downloadContainer = downloadContainers[videoId];
      downloadContainer.isPortDisconnected = true;
      downloadContainer.isDownloadable = false;

      (<HTMLInputElement>(
        document.querySelector(`[data-ytdl-playlist-checkbox="${videoId}"]`)
      )).disabled = true;
    });
  });
}
