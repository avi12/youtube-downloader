import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import Vue from "vue/dist/vue.min.js";
import {
  getCompatibleFilename,
  getDiffOption,
  getElementEventually,
  getStoredOptions,
  getVideoEventually,
  gExtToMime,
  initialOptions
} from "./utils";
import type { AdaptiveFormatItem, Options, VideoQueue } from "./types";
import { icons } from "./icons";
import {
  ErrorFileExtension,
  Icon,
  IconLoader,
  TabsDownloadTypes
} from "./content-script-components";

let gDownloadContainer: Vue;
export let gIntersectionObserverModal: IntersectionObserver;
export let gIntersectionObserverTooltipSingleVideo: IntersectionObserver;

function toggleNativeDownload(isVisible: boolean) {
  const selector = "ytd-download-button-renderer";
  const elementNodeListOf = document.querySelectorAll(selector);
  for (const elDownload of elementNodeListOf) {
    (<HTMLElement>elDownload).style.display = isVisible
      ? "inline-block"
      : "none";
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

  const { isRemoveNativeDownload, ext, videoQualityMode, videoQuality } =
    await getStoredOptions();
  if (isRemoveNativeDownload) {
    toggleNativeDownload(false);
  }

  elButtonAfterRating.parentElement.insertBefore(
    elDownloaderContainer,
    elButtonAfterRating
  );

  const { videoId, title } = videoData.videoDetails;

  const isMusic =
    videoData.microformat.playerMicroformatRenderer.category === "Music";
  gDownloadContainer = new Vue({
    el: `#${elDownloaderContainer.id}`,
    components: {
      Icon,
      IconLoader,
      ErrorFileExtension,
      TabsDownloadTypes
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
      ext: isMusic ? ext.audio : ext.video,
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
      <section class="ytdl-container ytdl-container--single-video" :id="containerId">
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

          <TabsDownloadTypes :download-type="downloadType"
                             :audio-url="audioUrl"
                             :video-url="videoUrl"
                             :audios="audios"
                             :videos="videos"
                             :is-starteed-download="isStartedDownload"
                             :filename-output="filenameOutput"
                             :exts-supported-for-type="extsSupportedForType"
                             :audio-bitrate="audioBitrate"
                             :ext="ext"
                             @change-filename-output="pFilename => filenameOutput = pFilename"
                             @change-video-url="url => updateMediaItem('video', url)"
                             @change-audio-url="url => updateMediaItem('audio', url)"
                             @change-download-type="pDownloadType => downloadType = pDownloadType" />

          <div class="ytdl-tooltip">
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
            <span class="ytdl-tooltip__text"
                  v-if="isDownloadable">{{ isStartedDownload ? tooltipProgress : tooltipDownloadDetails }}</span>
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
      downloadType(type: "audio" | "video++audio" | "video") {
        this.isStartedDownload = false;
        this.progress = 0;
        if (type === "audio") {
          this.ext = "mp3";
          return;
        }

        this.audio = this.audios[0];
        this.ext = "mp4";
      },
      isPortDisconnected() {
        this.isRichOptions = false;
        this.isDownloadable = false;
        toggleNativeDownload(true);
      },
      progress(progress: number) {
        const elRichDownload = document.querySelector(
          ".ytdl-container__rich-options__action-button"
        );
        const { width: widthRaw } = getComputedStyle(elRichDownload);
        const width = Number(widthRaw.replace("px", ""));
        this.widthProgressDownloadButton = (progress * 100 * width) / 100;
      },
      video(video: AdaptiveFormatItem) {
        this.videoUrl = video?.url;
      },
      audio(audio: AdaptiveFormatItem) {
        this.audioUrl = audio?.url;
      },
      ext(ext: string) {
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
        if (!videoData.streamingData) {
          return [];
        }
        const formats =
          videoData.streamingData.adaptiveFormats ||
          videoData.streamingData.formats;

        return formats.sort((a, b) => b.bitrate - a.bitrate);
      },
      filenameOutput: {
        set(filenameFull: string) {
          const split = filenameFull.trim().split(".");
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
        if (!this.isRichOptions) {
          return "More options";
        }
        return !this.isStartedDownload && !this.isDoneDownloading
          ? "Click DONE"
          : "Less options";
      },
      audioBitrate() {
        return Math.floor(this.audio?.bitrate / 1000);
      },
      tooltipDownloadDetails() {
        if (this.isDoneDownloading) {
          return "Done";
        }

        const strings = [];
        if (!this.isStartedDownload) {
          strings.push("Download in");
        } else {
          strings.push("Downloading in");
        }

        if (this.downloadType === "audio") {
          strings.push(this.audioBitrate, "kbps");
        } else {
          strings.push(
            this.video
              ? this.getVideoQuality(this.video) + "p"
              : "high quality",
            this.video?.fps,
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
      },
      async getElVideoQuality() {
        const { videoHeight, videoWidth } = document.querySelector("video");
        return Math.min(videoHeight, videoWidth);
      },
      getVideoQuality(video: AdaptiveFormatItem): number {
        return Math.min(video.height, video.width);
      },
      async getVideoByCurrentQuality() {
        for (const video of this.videos) {
          const currentVideoItemQuality = this.getVideoQuality(video);
          const elVideoQuality = await this.getElVideoQuality();
          if (currentVideoItemQuality === elVideoQuality) {
            return video;
          }
        }
        return this.videos[0];
      },
      getIVideoByQuality(quality: number) {
        return this.videos.findIndex(
          (video: AdaptiveFormatItem) => this.getVideoQuality(video) === quality
        );
      },
      updateMediaItem(type: "audio" | "video", urlToFind: string) {
        this[type] = this[`${type}s`].find(({ url }) => url === urlToFind);
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

      this.audio = this.audios[0];

      if (videoQualityMode === "current-quality") {
        this.video = await this.getVideoByCurrentQuality();
        (await getVideoEventually()).addEventListener(
          "canplay",
          onQualityChange
        );
      } else if (videoQualityMode === "best") {
        this.video = this.videos[0];
      } else if (videoQualityMode === "custom") {
        this.video =
          this.videos?.[this.getIVideoByQuality(videoQuality)] ??
          this.videos[0];
      }
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

  async function storageListener(changes) {
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

    const options = changes.options?.newValue as Options;
    if (options) {
      const optionsPrev =
        (changes.options?.oldValue as Options) ?? initialOptions;
      const diffOption = getDiffOption(options, optionsPrev);
      const optionChanged = Object.keys(diffOption)[0] as
        | "ext"
        | "isRemoveNativeDownload"
        | "videoQualityMode"
        | "videoQuality";

      if (optionChanged === "ext") {
        gDownloadContainer.ext =
          gDownloadContainer.downloadType === "audio"
            ? options.ext.audio
            : options.ext.video;
        return;
      }

      if (optionChanged === "isRemoveNativeDownload") {
        toggleNativeDownload(!options.isRemoveNativeDownload);
        return;
      }

      if (optionChanged === "videoQualityMode") {
        const elVideo = document.querySelector("video");
        const { videoQualityMode } = options;

        if (videoQualityMode === "current-quality") {
          elVideo.removeEventListener("canplay", onQualityChange);
          elVideo.addEventListener("canplay", onQualityChange);
          gDownloadContainer.video =
            await gDownloadContainer.getVideoByCurrentQuality();
          return;
        }

        if (videoQualityMode === "best") {
          elVideo.removeEventListener("canplay", onQualityChange);
          gDownloadContainer.video = gDownloadContainer.videos[0];
          return;
        }

        // videoQualityMode === "custom"
        elVideo.removeEventListener("canplay", onQualityChange);
        const iQuality = gDownloadContainer.getIVideoByQuality(
          options.videoQuality
        );
        gDownloadContainer.video =
          gDownloadContainer.videos?.[iQuality] ?? gDownloadContainer.videos[0];
        return;
      }

      if (optionChanged === "videoQuality") {
        const iQuality = gDownloadContainer.getIVideoByQuality(
          options.videoQuality
        );
        gDownloadContainer.video =
          gDownloadContainer.videos?.[iQuality] ?? gDownloadContainer.videos[0];
      }
    }
  }
}

export async function onQualityChange(): Promise<void> {
  // Set the video URL on quality change, if option videoQualityMode === "current-selected"
  gDownloadContainer.video =
    await gDownloadContainer.getVideoByCurrentQuality();
}
