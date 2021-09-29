import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import Vue from "vue/dist/vue.min.js";
import {
  getCompatibleFilename,
  getElementEventually,
  getVideoEventually,
  gExtToMime
} from "./utils";
import type { AdaptiveFormatItem, VideoQueue } from "./types";
import { icons } from "./icons";
import {
  ErrorFileExtension,
  Icon,
  IconLoader
} from "./content-script-components";

let gDownloadContainer: Vue;
export let gIntersectionObserverModal: IntersectionObserver;
export let gIntersectionObserverTooltipSingleVideo: IntersectionObserver;

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
    components: {
      Icon,
      IconLoader,
      ErrorFileExtension
    },
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
      isRichOptions: false,
      videos: [] as AdaptiveFormatItem[],
      audios: [] as AdaptiveFormatItem[],
      audio: null as AdaptiveFormatItem,
      video: null as AdaptiveFormatItem,
      videoUrl: "",
      audioUrl: "",
      isMoveModalUp: false,
      isMovePrimaryTooltipsUp: false,
      widthProgressDownloadButton: 0,
      icons,
      containerId: elDownloaderContainer.id
    },
    template: `
      <section class="ytdl-container ytdl-container--single-video" :id="containerId" v-if="video">
      <div class="ytdl-action-buttons">
        <IconLoader />

        <div v-if="!isRichOptions" class="ytdl-tooltip" :class="{'ytdl-tooltip--bottom': isMovePrimaryTooltipsUp}">
          <button @click="toggleDownload"
                  :disabled="isRichOptions || !isDownloadable"
                  class="ytdl-action-buttons__button">
            <Icon :type="currentDownloadIcon" />
            {{ textButton }}
          </button>
          <span class="ytdl-tooltip__text" v-if="isDownloadable">{{ tooltipDownloadDetails }}</span>
        </div>
        <button v-else disabled class="ytdl-action-buttons__button">
          <Icon type="download" />
          DOWNLOAD
        </button>

        <div class="ytdl-tooltip" :class="{'ytdl-tooltip--bottom': isMovePrimaryTooltipsUp}">
          <button v-if="${getIsDownloadable(videoData)}"
                  @click="isRichOptions = !isRichOptions"
                  class="ytdl-action-buttons__button tooltip-bottom"
                  :disabled="!isDownloadable || isStartedDownload"
                  :aria-label="labelExpandButton">
            <Icon type="expand" />
          </button>
          <span class="ytdl-tooltip__text" v-if="isDownloadable">{{ labelExpandButton }}</span>
        </div>
      </div>

      <div class="ytdl-container__rich-options-wrapper ytdl-container__rich-options-wrapper--floating"
           v-show="isRichOptions"
           :class="{'ytdl-container__rich-options-wrapper--floating-up': isMoveModalUp}">
        <div class="ytdl-container__rich-options">
          <div class="ytdl-container__tabs-buttons">
            <button @click="downloadType = 'video+audio'"
                    :disabled="isStartedDownload"
                    class="ytdl-container__tab-button"
                    :class="{'ytdl-container__tab-button--selected': downloadType === 'video+audio' || downloadType === 'video'}">
              Video
            </button>
            <button @click="downloadType = 'audio'"
                    :disabled="isStartedDownload"
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
                          :key="audio.url">{{ audioBitrate }} kbps {{ i === 0 ? "(best)" : "" }}
                  </option>
                </select> </label>

              <div class="ytdl-container__spacer--margin-top"></div>
              <label>Filename
                <br>
                <input autocomplete="off"
                       type="text"
                       :disabled="isStartedDownload"
                       class="ytdl-container__filename-option-input"
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
                       v-model="filenameOutput"> </label>
            </div>

            <ErrorFileExtension :ext="ext" :exts-supported-for-type="extsSupportedForType" />

            <div class="ytdl-tooltip">
              <button @click="toggleDownload"
                      :disabled="!isDownloadable"
                      class="ytdl-container__rich-options__action-button">
                <div class="ytdl-container__rich-options__progress"
                     :style="{width: widthProgressDownloadButton + 'px'}">
                  <div class="ytdl-container__rich-options__action-button__new-text">
                    {{ textButton }}
                  </div>
                </div>
                {{ textButton }}
              </button>
              <span class="ytdl-tooltip__text" v-if="isDownloadable">{{ tooltipDownloadDetails }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="ytdl-tooltip">
        <progress :value="progress"
                  v-show="!isRichOptions"
                  ref="progress"
                  :data-progress-type="progressType"
                  :data-download-type="downloadType"></progress>
        <span class="ytdl-tooltip__text"
              :class="{'ytdl-tooltip__text--bottom': isMovePrimaryTooltipsUp}"
              v-show="isShowProgress">{{ tooltipProgress }}</span></div>
      </section>
    `,
    watch: {
      downloadType(type) {
        this.isStartedDownload = false;
        this.progress = 0;
        if (type === "audio") {
          this.ext = "mp3";
          return;
        }

        this.audioUrl = this.audios[0].url;
        this.ext = "mp4";
      },
      isPortDisconnected() {
        this.isRichOptions = false;
        this.isDownloadable = false;
      },
      progress(progress) {
        const elRichDownload = document.querySelector(
          ".ytdl-container__rich-options__action-button"
        );
        const { width: widthRaw } = getComputedStyle(elRichDownload);
        const width = Number(widthRaw.replace("px", ""));
        this.widthProgressDownloadButton = (progress * 100 * width) / 100;
      },
      videoUrl(urlNew) {
        this.video = this.videos.find(({ url }) => url === urlNew);
      },
      audioUrl(urlNew) {
        this.audio = this.audios.find(({ url }) => url === urlNew);
      },
      ext(ext) {
        this.isDownloadable = Boolean(
          gExtToMime[this.extsSupportedForType][ext]
        );
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
            return "not-downloadable";

          case "DONE":
            return "download-completed";

          case "QUEUED":
            return "download-queue";

          case "CANCEL":
            return "cancel-download";

          default:
            return "download";
        }
      },
      compatibleFilename() {
        return getCompatibleFilename(this.filenameOutput);
      },
      extsSupportedForType() {
        return this.downloadType === "audio" ? "audio" : "video";
      },
      labelExpandButton() {
        return !this.isRichOptions ? "More options" : "Less options";
      },
      audioBitrate() {
        return Math.floor(this.audio.bitrate / 1000);
      },
      tooltipDownloadDetails() {
        if (this.isDoneDownloading) {
          return "Done";
        }

        if (this.isStartedDownload) {
          return this.tooltipProgress;
        }

        const strings = [`Download in`];
        if (this.downloadType === "audio") {
          strings.push(this.audioBitrate, "kbps");
        } else {
          strings.push(
            this.getVideoQuality(this.video) + "p",
            this.video.fps,
            "FPS"
          );
        }
        strings.push("as", `"${this.compatibleFilename}"`);
        return strings.join(" ");
      },
      tooltipProgress() {
        const progress = (this.progress * 100).toFixed(2);
        const strProgress = `${progress}%`;
        if (this.downloadType !== "video+audio") {
          return `${strProgress} (downloading ${this.downloadType}-only)`;
        }

        const strings = [strProgress];

        if (this.progressType !== "ffmpeg") {
          strings.push(`(downloading ${this.progressType || "video"})`);
        } else {
          strings.push("(stitching video & audio)");
        }

        return strings.join(" ");
      },
      isShowProgress() {
        const isProgressBetween = this.progress > 0 && this.progress < 1;
        return (
          (this.downloadType === "video+audio" && isProgressBetween) ||
          (this.downloadType === "video+audio" &&
            this.progress === 0 &&
            this.progressType !== "") ||
          (this.downloadType === "video+audio" &&
            this.progress === 1 &&
            this.progressType === "video") ||
          (this.downloadType === "video+audio" &&
            this.progress === 1 &&
            this.progressType === "audio") ||
          (this.downloadType === "video" && isProgressBetween) ||
          (this.downloadType === "audio" && isProgressBetween)
        );
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
      async getElVideoQuality() {
        const { videoHeight, videoWidth } = await getVideoEventually();
        return Math.min(videoHeight, videoWidth);
      },
      getVideoQuality(video: AdaptiveFormatItem) {
        return Math.min(video.height, video.width);
      },
      async getVideoByCurrentQuality() {
        return this.videos.find(async video => {
          const [currentVideoItemQuality, elVideoQuality] = await Promise.all([
            this.getVideoQuality(video),
            this.getElVideoQuality()
          ]);
          return currentVideoItemQuality === elVideoQuality;
        });
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
    async created() {
      chrome.runtime.onMessage.addListener(progressListener);
      chrome.storage.onChanged.addListener(storageListener);

      gPorts.main.onDisconnect.addListener(() => {
        this.isPortDisconnected = true;
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

      this.video = await this.getVideoByCurrentQuality();
      this.audio = this.audios[0];

      this.videoUrl = this.video.url;
      this.audioUrl = this.audio.url;

      const elVideo = document.querySelector("video");
      elVideo.addEventListener("canplay", onQualityChange);
    },
    mounted() {
      gIntersectionObserverModal = new IntersectionObserver(
        entries => {
          const { isIntersecting } = entries[0];
          this.isMoveModalUp = isIntersecting;
        },
        {
          rootMargin: "280px"
        }
      );
      gIntersectionObserverModal.observe(document.documentElement);

      gIntersectionObserverTooltipSingleVideo = new IntersectionObserver(
        entries => {
          const { isIntersecting } = entries[0];
          this.isMovePrimaryTooltipsUp = !isIntersecting;
        },
        {
          rootMargin: "30px"
        }
      );
      gIntersectionObserverTooltipSingleVideo.observe(document.documentElement);
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
        gDownloadContainer.progressType = "";
      }
      gDownloadContainer.isDoneDownloading = !isDownloading;
      return;
    }
  }
}

export async function onQualityChange(): Promise<void> {
  // Set the video URL on quality change
  gDownloadContainer.video =
    await gDownloadContainer.getVideoByCurrentQuality();
  gDownloadContainer.videoUrl = gDownloadContainer.video.url;
}
