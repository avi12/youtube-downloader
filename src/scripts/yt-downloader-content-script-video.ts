import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import Vue from "vue/dist/vue.min.js";
import {
  getElementEventually,
  gExtToMime,
  gSupportedExts,
  isElementInViewport
} from "./utils";
import type { AdaptiveFormatItem, VideoQueue } from "./types";
import { icons } from "./icons";

let gDownloadContainer: Vue;
export let gObserverRichOptionsSingleMedia: MutationObserver;

export function moveModalSingleMediaWhenNeeded(): void {
  const elRichOptions = document.querySelector(
    ".ytdl-container__rich-options-wrapper"
  );
  if (elRichOptions) {
    gDownloadContainer.isMoveModalUp = !isElementInViewport(elRichOptions);
  }
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

  gDownloadContainer = new Vue({
    el: `#${elDownloaderContainer.id}`,
    data: {
      isStartedDownload: false,
      isDoneDownloading: false,
      isDownloadable: getIsDownloadable(videoData),
      progress: 0,
      progressType: "" as "" | "video" | "audio" | "ffmpeg",
      isQueued: false,
      isPortDisconnected: false,
      downloadType: (isMusic ? "audio" : "video+audio") as
        | "video"
        | "audio"
        | "video+audio",
      filename: title,
      ext,
      gSupportedExts,
      errorFilename: "",
      isRichOptions: false,
      videos: [] as AdaptiveFormatItem[],
      audios: [] as AdaptiveFormatItem[],
      videoUrl: "",
      audioUrl: "",
      isMoveModalUp: false,
      widthProgressDownloadButton: 0,
      icons
    },
    template: `
      <section class="ytdl-container ytdl-container--single-video" id="${
        elDownloaderContainer.id
      }">
      <div class="ytdl-action-buttons">
        <button @click="toggleDownload"
                :disabled="isRichOptions || !isDownloadable"
                class="ytdl-action-buttons__button"
                v-if="!isRichOptions">
          <span v-html="currentDownloadIcon" class="ytdl-action-buttons__icon"></span> {{ textButton }}
        </button>
        <button v-else disabled class="ytdl-action-buttons__button">
          <span class="ytdl-action-buttons__icon" v-html="icons.download"></span> DOWNLOAD
        </button>

        <button v-if="${getIsDownloadable(videoData)}"
                @click="isRichOptions = !isRichOptions"
                class="ytdl-action-buttons__button"
                :disabled="!isDownloadable || isStartedDownload"
                aria-label="More options">
          ${icons.expand}
        </button>
      </div>

      <div class="ytdl-container__rich-options-wrapper ytdl-container__rich-options-wrapper--floating"
           v-show="isRichOptions"
           :class="{'ytdl-container__rich-options-wrapper--floating-up': isMoveModalUp}">
        <div class="ytdl-container__rich-options">
          <div class="ytdl-container__tabs-buttons">
            <button @click="downloadType = 'video+audio'"
                    class="ytdl-container__tab-button"
                    :class="{'ytdl-container__tab-button--selected': downloadType === 'video+audio' || downloadType === 'video'}">
              Video
            </button>
            <button @click="downloadType = 'audio'"
                    class="ytdl-container__tab-button"
                    :class="{'ytdl-container__tab-button--selected': downloadType === 'audio'}">
              Audio
            </button>
          </div>

          <div class="ytdl-container__tab-content">
            <div v-if="downloadType === 'audio'">
              <label> Audio quality
                <br>
                <select class="ytdl-container__quality-option-input" v-model="audioUrl">
                  <option :value="audio.url"
                          v-for="(audio, i) of audios"
                          :key="audio.url">{{ Math.floor(audio.bitrate / 1000) }} kbps {{ i === 0 ? "(best)" : "" }}
                  </option>
                </select> </label>

              <div class="ytdl-container__spacer--margin-top"></div>
              <label>Filename
                <br>
                <input autocomplete="off"
                       type="text"
                       :disabled="isStartedDownload"
                       class="ytdl-container__filename-option-input"
                       :class="{'ytdl-container__filename-option-input--error': errorFilename}"
                       v-model="filenameOutput"> </label>
            </div>
            <div v-else>
              <label> <input type="checkbox"
                             class="ytdl-container__video-option-audio-input"
                             checked
                             @input="e => downloadType = e.target.checked ? 'video+audio' : 'video'" /> Include audio (best quality)</label>

              <div class="ytdl-container__spacer--margin-top"></div>
              <label> Video quality
                <br>
                <select class="ytdl-container__video-option-quality-input" v-model="videoUrl">
                  <option :value="video.url"
                          v-for="(video, i) of videos"
                          :key="video.url">{{ video.height }}p {{ video.fps }} FPS {{ i === 0 ? "(best)" : "" }}
                  </option>
                </select> </label>

              <div class="ytdl-container__spacer--margin-top"></div>
              <label> Filename
                <br>
                <input type="text"
                       :disabled="isStartedDownload"
                       autocomplete="off"
                       class="ytdl-container__filename-option-input"
                       :class="{'ytdl-container__filename-option-input--error': errorFilename}"
                       v-model="filenameOutput"> </label>
            </div>

            <transition name="slide">
              <div class="ytdl-container__filename-error" v-if="errorFilename">
                Unsupported {{ extsSupportedForType }} extension: <b>{{ errorFilename }}</b>
                <br>
                Supported ones: <span class="ytdl-container__filename-error--supported-extensions">
                        {{ gSupportedExts[extsSupportedForType].join(", ") }}
                      </span>
              </div>
            </transition>

            <button @click="toggleDownload"
                    :disabled="!isDownloadable"
                    class="ytdl-container__rich-options__action-button">
              <div class="ytdl-container__rich-options__progress" :style="{width: widthProgressDownloadButton + 'px'}">
                <div class="ytdl-container__rich-options__action-button__new-text">
                  {{ textButton }}
                </div>
              </div>
              {{ textButton }}
            </button>
          </div>
        </div>
      </div>
      <progress :value="progress"
                v-show="!isRichOptions"
                :data-progress-type="progressType"
                :data-download-type="downloadType"></progress>
      </section>
    `,
    watch: {
      ext(ext) {
        if (this.downloadType === "audio") {
          if (gExtToMime.audio[ext]) {
            this.errorFilename = "";
            return;
          }

          this.errorFilename = ext;
          return;
        }

        if (gExtToMime.video[ext]) {
          this.errorFilename = "";
          return;
        }

        this.errorFilename = ext;
      },
      downloadType(type) {
        this.progress = 0;
        this.errorFilename = "";
        if (type === "audio") {
          this.ext = "mp3";
          return;
        }

        this.audioUrl = this.audios[0].url;
        this.ext = "mp4";
      },
      isPortDisconnected() {
        this.isRichOptions = false;
      },
      errorFilename(error) {
        this.isDownloadable = !error;
      },
      progress(progress) {
        const elRichDownload = document.querySelector(
          ".ytdl-rich-options__download-button"
        );
        const { width: widthRaw } = getComputedStyle(elRichDownload);
        const width = Number(widthRaw.replace("px", ""));
        this.widthProgressDownloadButton = (progress * 100 * width) / 100;
      }
    },
    computed: {
      textButton() {
        if (this.isPortDisconnected) {
          return "RELOAD TO DOWNLOAD";
        }
        if (!this.isDownloadable) {
          return "NOT DOWNLOADABLE";
        }
        if (
          this.isDoneDownloading &&
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
      filenameOutput: {
        set(filenameFull: string) {
          const split = filenameFull.split(".");
          this.ext = split.pop();
          this.filename = split.join(".");
        },
        get() {
          return `${this.filename}.${this.ext}`;
        }
      },
      currentDownloadIcon() {
        switch (this.textButton) {
          case "RELOAD TO DOWNLOAD":
          case "NOT DOWNLOADABLE":
            return icons.notDownloadable;

          case "DONE":
            return icons.downloadCompleted;

          case "QUEUED":
            return icons.downloadQueue;

          case "CANCEL":
            return icons.cancelDownload;

          default:
            return icons.download;
        }
      },
      extsSupportedForType() {
        return this.downloadType === "audio" ? "audio" : "video";
      }
    },
    methods: {
      toggleDownload() {
        this.isDoneDownloading = false;
        this.isStartedDownload = !this.isStartedDownload;

        if (this.downloadType === "video+audio") {
          this.progressType = "";
        }

        this.progress = 0;
        if (!this.isStartedDownload || this.isQueued) {
          chrome.runtime.sendMessage({
            action: "cancel-download",
            videoIdsToCancel: [videoId]
          });
          return;
        }

        this.download();
      },
      download() {
        gPorts.processSingle.postMessage({
          type: this.downloadType,
          urls: {
            video: this.videoUrl,
            audio: this.audioUrl
          },
          filenameOutput: this.filenameOutput,
          videoId
        });
      }
    },
    created() {
      chrome.runtime.onMessage.addListener(progressListener);
      chrome.storage.onChanged.addListener(storageListener);
      document.addEventListener("scroll", moveModalSingleMediaWhenNeeded);

      gPorts.main.onDisconnect.addListener(() => {
        this.isPortDisconnected = true;
        this.isDownloadable = false;
      });

      this.formatsSorted.forEach(format => {
        if (format.mimeType.startsWith("video")) {
          if (this.videos.length === 0) {
            this.videos.push(format);
            return;
          }

          if (!this.videos.some(video => format.height === video.height)) {
            this.videos.push(format);
          }
          return;
        }

        this.audios.push(format);
      });

      this.videoUrl = this.videos[0].url;
      this.audioUrl = this.audios[0].url;
    },
    mounted() {
      gObserverRichOptionsSingleMedia = new MutationObserver(
        moveModalSingleMediaWhenNeeded
      );
      gObserverRichOptionsSingleMedia.observe(
        document.querySelector(".ytdl-container__rich-options-wrapper"),
        {
          attributes: true,
          attributeFilter: ["style"]
        }
      );
    }
  });

  function progressListener({
    updateProgress: { progress, progressType, isRemoved }
  }) {
    if (isRemoved) {
      gDownloadContainer.progress = 0;
      gDownloadContainer.progressType =
        gDownloadContainer.downloadType === "video+audio"
          ? ""
          : gDownloadContainer.downloadType;
      gDownloadContainer.isStartedDownload = false;
      gDownloadContainer.isDoneDownloading = false;
      gDownloadContainer.isQueued = false;
      return;
    }

    gDownloadContainer.progress = progress;
    gDownloadContainer.progressType = progressType;
    gDownloadContainer.isDoneDownloading = progress === 1;
  }

  function storageListener(changes) {
    const videoQueue = changes.videoQueue?.newValue as VideoQueue;
    if (videoQueue) {
      const { videoId } = videoData.videoDetails;
      const isInQueue = videoQueue.includes(videoId);
      const isDownloading = videoQueue[0] === videoId;
      gDownloadContainer.isQueued = isInQueue && !isDownloading;
      if (isDownloading) {
        gDownloadContainer.progress = 0;
      }
      gDownloadContainer.isDoneDownloading = !isDownloading;
      return;
    }
  }
}
