import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import {
  getCompatibleFilename,
  getDiffOption,
  getElementsEventually,
  getStoredOption,
  getStoredOptions,
  gExtToMime,
  gSupportedExts,
  initialOptions,
  isElementVisible
} from "./utils";
import Vue from "vue/dist/vue.min.js";
import type {
  AdaptiveFormatItem,
  MusicList,
  OptionFileExtension,
  Options,
  PlayerResponse,
  VideoOnlyList,
  VideoQueue
} from "./types";
import { icons } from "./icons";
import {
  ErrorFileExtension,
  Icon,
  IconLoader,
  TabsDownloadTypes
} from "./content-script-components";

export let gMutationObserverPlaylistProgress: MutationObserver;
export let gMutationObserverPlaylistVideoReadiness: MutationObserver;
let gDownloadContainers: { [videoId: string]: Vue };
let gDownloadPlaylist: Vue;

export function onCheckboxUpdate(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (!target.matches("[data-ytdl-playlist-checkbox]")) {
    return;
  }

  gDownloadPlaylist.setTooltipDownloadDetails();
  gDownloadPlaylist.error = "";
}

export function getVideosContainer(): HTMLDivElement {
  return document.querySelector("#contents");
}

function appendDownloadContainer({
  videoId,
  elVideoItem
}: {
  videoId: string;
  elVideoItem: Element;
}) {
  if (document.querySelector(`[data-ytdl-download-container="${videoId}"]`)) {
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
  if (
    isElementVisible(
      document.querySelector(`[data-ytdl-playlist-checkbox="${videoId}"]`)
    )
  ) {
    return;
  }
  const elCheckboxContainer = document.createElement("div");
  elCheckboxContainer.className = "ytdl-container__checkbox";
  elCheckboxContainer.style.width = "0";

  const disabled = gDownloadPlaylist.isStartedDownload ? "disabled" : "";
  elCheckboxContainer.innerHTML = `<input type="checkbox" data-ytdl-playlist-checkbox="${videoId}" ${disabled} />`;
  elVideoNumberContainer.append(elCheckboxContainer);

  setTimeout(() => {
    elCheckboxContainer.style.width = "31px";
  }, 500);
}

function getCheckbox(videoId: string): HTMLInputElement {
  return document.querySelector(`[data-ytdl-playlist-checkbox="${videoId}"]`);
}

function getProgressBar(videoId: string): HTMLProgressElement {
  return document.querySelector(
    `[data-ytdl-download-container="${videoId}"] progress[data-progress-type]`
  );
}

export async function appendPlaylistDownloadButton(): Promise<void> {
  const elDownloadPlaylistContainer = document.querySelector(
    "ytd-playlist-sidebar-primary-info-renderer"
  );

  const elDownloadPlaylist = document.createElement("div");
  elDownloadPlaylist.id = "ytdl-container__playlist";

  const isNoVideosAvailable = !document.querySelector("#meta");
  const isButtonAlreadyPlaced = Boolean(
    document.querySelector(`#${elDownloadPlaylist.id}`)
  );
  if (isButtonAlreadyPlaced || isNoVideosAvailable) {
    return;
  }

  const countVideosTotal = Number(
    document
      .querySelector("#stats")
      .textContent.match(/[\d,]+/)[0]
      .replaceAll(",", "")
  );
  const isVideosMatch = () =>
    document.querySelectorAll("ytd-playlist-video-renderer").length ===
    document.querySelectorAll(".ytdl-container--playlist-single-video").length;

  const scrollToBottom = () =>
    scrollBy({ top: getVideosContainer().clientHeight });

  elDownloadPlaylistContainer.insertBefore(
    elDownloadPlaylist,
    elDownloadPlaylistContainer.querySelector("#play-buttons")
  );

  const options = await getStoredOptions();

  let unwatchInspection;

  gDownloadPlaylist = new Vue({
    el: `#${elDownloadPlaylist.id}`,
    components: {
      Icon,
      IconLoader,
      ErrorFileExtension
    },
    data: {
      isStartedDownload: false,
      isStartedDownloadAll: false,
      progress: 0,
      error: "",
      isAllChecked: false,
      countVideosDownloaded: 0,
      isPortDisconnected: false,
      videoIdsToDownload: [] as VideoQueue | VideoOnlyList | MusicList,
      icons,
      tooltipDownloadDetails: "",
      isInspectingPlaylistVideos: false,
      isCancelDownloadALl: false,
      isCanDownloadAll: false,
      isPlaylistDownloadable: false,
      isRichOptions: false,
      extAudio: options.ext.audio,
      extVideo: options.ext.video,
      extAudiolessVideo: options.ext.video,
      downloadTypeTotal: "default" as
        | "default"
        | "video+audio"
        | "video"
        | "audio",
      gExtToMime,
      gSupportedExts
    },
    template: `
      <transition name="slide">
      <section v-show="isPlaylistDownloadable"
               id="${elDownloadPlaylist.id}"
               class="ytdl-action-buttons ytdl-container ytdl-container__playlist">
        <IconLoader />

        <!-- More options button -->
        <div class="ytdl-tooltip">
          <button :aria-label="labelExpandButton"
                  :disabled="isPortDisconnected || !isSupportedExts || isStartedDownload || isStartedDownloadAll"
                  class="ytdl-action-buttons__button tooltip-bottom"
                  @click="isRichOptions = !isRichOptions">
            <Icon type="options" class="ytdl-action-buttons__action--icon" />
            PLAYLIST DOWNLOAD OPTIONS
          </button>
          <span class="ytdl-tooltip__text"
                v-if="!isStartedDownloadAll && isSupportedExts">{{ labelExpandButton }}</span>
        </div>

        <transition name="slide-rich-options-playlist">
          <div v-if="isRichOptions"
               class="ytdl-container__rich-options-wrapper ytdl-container__rich-options-wrapper--playlist ytdl-container__rich-options-wrapper--in-place">
            <div class="ytdl-container__rich-options">
              <div class="ytdl-container__spacer--margin-top"></div>
              Download all videos as
              <form class="ytdl-container__rich-options__form">
                <label for="rich-options--download-type-audio">
                  <!-- Audio-only -->
                  <input v-model="downloadTypeTotal" name="download-type" type="radio" value="audio">Audio</label>
                <!-- -->
                <input autocomplete="off"
                       id="rich-options--download-type-audio"
                       type="text"
                       v-model="extAudio"
                       @focus="downloadTypeTotal = 'audio'" />

                <ErrorFileExtension :ext="extAudio" exts-supported-for-type="audio" />


                <label for="rich-options--download-type-video+audio">
                  <!-- Video + audio -->
                  <input v-model="downloadTypeTotal" name="download-type" type="radio" value="video+audio">Video</label>
                <!-- -->
                <input autocomplete="off"
                       id="rich-options--download-type-video+audio"
                       type="text"
                       v-model="extVideo"
                       @focus="downloadTypeTotal = 'video+audio'" />

                <ErrorFileExtension :ext="extVideo" exts-supported-for-type="video" />


                <label for="rich-options--download-type-video">
                  <!-- Video-only -->
                  <input v-model="downloadTypeTotal"
                         name="download-type"
                         type="radio"
                         value="video">Audio-less video</label>
                <!-- -->
                <input autocomplete="off"
                       id="rich-options--download-type-video"
                       type="text"
                       v-model="extAudiolessVideo"
                       @focus="downloadTypeTotal = 'video'" />

                <ErrorFileExtension :ext="extAudiolessVideo" exts-supported-for-type="video" />

                <label><input v-model="downloadTypeTotal"
                              name="download-type"
                              type="radio"
                              value="default">Use the initial values</label>
              </form>
              <div class="ytdl-container__spacer--margin-top"></div>
            </div>
          </div>
        </transition>

        <!-- Download all when ready -->
        <button :disabled="isPortDisconnected || !isSupportedExts || isStartedDownload"
                class="ytdl-action-buttons__button"
                @click="downloadAllWhenPossible">
          <Icon type="download-all" />
          {{ isStartedDownloadAll ? "DON'T" : "" }} DOWNLOAD ALL WHEN READY
        </button>

        <!-- Toggle all -->
        <button id="ytdl-toggle-checkbox"
                :disabled="isPortDisconnected || !isSupportedExts || isStartedDownload || isStartedDownloadAll"
                class="ytdl-action-buttons__button"
                @click="toggleCheckboxes">
          <Icon :type="iconToggle"></Icon>
          TOGGLE ALL
        </button>

        <!-- Download button -->
        <div class="ytdl-tooltip ytdl-tooltip--bottom-left">
          <button :disabled="isPortDisconnected || !isSupportedExts || isInspectingPlaylistVideos"
                  class="ytdl-action-buttons__button"
                  @click="toggleDownload">
            <Icon :type="currentDownloadIcon" />
            {{ textButton }}
          </button>
          <span class="ytdl-tooltip__text"
                v-if="!isStartedDownload && !isInspectingPlaylistVideos">{{ tooltipDownloadDetails }}</span>
        </div>

        <transition-group name="slide-short" tag="div">
          <div v-if="isStartedDownload && videoIdsToDownload.length > 0"
               key="count"
               class="ytdl--size-medium ytdl--text-color-default">
            Downloaded {{ countVideosDownloaded }} out of {{ videoIdsToDownload.length }} video{{ videoIdsToDownload.length === 1 ? "" : "s" }}
          </div>
          <div v-if="error" key="error" class="ytdl-container__playlist--error ytdl--size-medium">{{ error }}</div>
        </transition-group>
      </section>
      </transition>
    `,
    watch: {
      isAllChecked() {
        this.error = "";
        this.setTooltipDownloadDetails();
      },
      countVideosDownloaded(numVideosDownloaded: number) {
        this.isStartedDownload =
          numVideosDownloaded < this.videoIdsToDownload.length;
      },
      countVideosToDownload(numVideosToDownload: number) {
        this.isStartedDownload = numVideosToDownload > 0;
      },
      isPortDisconnected() {
        this.isRichOptions = false;
        this.isDownloadable = false;
      },
      async downloadTypeTotal(downloadType) {
        const options = await getStoredOptions();
        const isDefault = downloadType === "default";
        for (const videoId in gDownloadContainers) {
          const downloadContainer = gDownloadContainers[videoId];
          downloadContainer.downloadType = isDefault
            ? downloadContainer.downloadTypeInitial
            : downloadType;

          if (options.videoQualityMode === "best") {
            downloadContainer.video = downloadContainer.videos[0];
          } else if (options.videoQualityMode === "custom") {
            const iQuality = downloadContainer.getIVideoByQuality(
              options.videoQuality
            );
            downloadContainer.video =
              downloadContainer.videos?.[iQuality] ??
              downloadContainer.videos[0];
          }

          downloadContainer.progressType = "";
          downloadContainer.isDoneDownloading = false;
          downloadContainer.isStartedDownload = false;
        }
      },
      isInspectingPlaylistVideos() {
        this.isRichOptions = false;
      },
      async extAudio(extAudio) {
        const extOpt = (await getStoredOption("ext")) as OptionFileExtension;
        const isExists = gExtToMime.audio[extAudio];
        for (const videoId in gDownloadContainers) {
          const downloadContainer = gDownloadContainers[videoId];
          if (downloadContainer.downloadType === "audio") {
            downloadContainer.ext = isExists ? extAudio : extOpt.audio;
          }
        }
      },
      async extVideo(extVideo) {
        const extOpt = (await getStoredOption("ext")) as OptionFileExtension;
        const isExists = gExtToMime.video[extVideo];
        for (const videoId in gDownloadContainers) {
          const downloadContainer = gDownloadContainers[videoId];
          if (downloadContainer.downloadType === "video+audio") {
            downloadContainer.ext = isExists ? extVideo : extOpt.video;
          }
        }
      },
      async extAudiolessVideo(extVideo) {
        const extOpt = (await getStoredOption("ext")) as OptionFileExtension;
        const isExists = gExtToMime.video[extVideo];
        for (const videoId in gDownloadContainers) {
          const downloadContainer = gDownloadContainers[videoId];
          if (downloadContainer.downloadType === "video") {
            downloadContainer.ext = isExists ? extVideo : extOpt.video;
          }
        }
      }
    },
    computed: {
      textButton() {
        if (this.isPortDisconnected) {
          return "RELOAD TO DOWNLOAD";
        }

        if (!this.isSupportedExts) {
          return "EXTENSION UNSUPPORTED";
        }

        if (this.isStartedDownload) {
          return "CANCEL";
        }

        return "DOWNLOAD SELECTED";
      },
      currentDownloadIcon() {
        if (this.textButton === "RELOAD TO DOWNLOAD") {
          return "not-downloadable";
        }

        if (this.textButton === "CANCEL") {
          return "cancel-download";
        }

        return "download";
      },
      iconToggle() {
        return this.isAllChecked ? "toggle-on" : "toggle-off";
      },
      labelExpandButton() {
        return !this.isRichOptions ? "More options" : "Less options";
      },
      isSupportedExts() {
        if (this.downloadTypeTotal === "audio") {
          return this.gExtToMime.audio[this.extAudio];
        }

        if (this.downloadTypeTotal === "video+audio") {
          return this.gExtToMime.video[this.extVideo];
        }

        if (this.downloadTypeTotal === "video") {
          return this.gExtToMime.video[this.extAudiolessVideo];
        }

        return true;
      }
    },
    methods: {
      getCheckboxes() {
        return [...document.querySelectorAll("[data-ytdl-playlist-checkbox]")];
      },
      getTooltipDownloadDetails() {
        const strings = ["Selected"];

        const downloadTypes = {
          video: document.querySelectorAll(
            `[data-ytdl-playlist-checkbox][data-ytdl-playlist-checkbox-download-type="video+audio"]:checked`
          ).length,
          audio: document.querySelectorAll(
            `[data-ytdl-playlist-checkbox][data-ytdl-playlist-checkbox-download-type="audio"]:checked`
          ).length,
          "audio-less video": document.querySelectorAll(
            `[data-ytdl-playlist-checkbox][data-ytdl-playlist-checkbox-download-type="video"]:checked`
          ).length
        };

        const downloadTypesToStrings = Object.entries(downloadTypes)
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          .filter(([_, number]) => number > 0)
          .map(
            ([type, number]) => `${number} ${type}${number === 1 ? "" : "s"}`
          );

        if (downloadTypesToStrings.length > 0) {
          strings.push(downloadTypesToStrings.join(", "));
        } else {
          strings.push("nothing");
        }
        return strings.join(" ");
      },
      setTooltipDownloadDetails() {
        this.tooltipDownloadDetails = this.getTooltipDownloadDetails();
      },
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
        videoData: PlayerResponse;
      }[] {
        return this.getVideoIdsToDownload().map(videoId => {
          const downloadContainer = gDownloadContainers[videoId];
          return {
            type: downloadContainer.downloadType,
            urls: {
              video: downloadContainer.videoBest.url,
              audio: downloadContainer.audioBest.url
            },
            filenameOutput: downloadContainer.filenameOutput,
            videoId,
            videoData: downloadContainer.videoData
          };
        });
      },
      toggleDownload() {
        this.videoIdsToDownload = this.getVideoIdsToDownload();
        const isNoVideosSelected = this.videoIdsToDownload.length === 0;
        if (isNoVideosSelected) {
          this.error = "Select at least one video";
          return;
        }
        this.error = "";

        this.isStartedDownload = !this.isStartedDownload;
        this.isRichOptions = false;
        if (!this.isStartedDownload) {
          this.isStartedDownloadAll = false;
          chrome.runtime.sendMessage({
            action: "cancel-download",
            videoIdsToCancel: this.videoIdsToDownload
          });
          return;
        }

        this.disableAllCheckboxes(true);
        gPorts.processPlaylist.postMessage(this.getVideoInfosToDownload());
      },
      async downloadAllWhenPossible() {
        if (this.isInspectingPlaylistVideos) {
          gMutationObserverPlaylistVideoReadiness.disconnect();
          scrollTo({ top: 0 });
          this.isStartedDownloadAll = false;
          this.isInspectingPlaylistVideos = false;
          this.isCancelDownloadALl = true;
          unwatchInspection?.();
          return;
        }
        const startInspecting = async () => {
          this.setAllIndividualDownloadability(false);
          const elVideoContainer = getVideosContainer();
          gMutationObserverPlaylistVideoReadiness.observe(elVideoContainer, {
            childList: true,
            subtree: true
          });

          this.isCancelDownloadALl = false;
          this.isStartedDownloadAll = true;
          this.isInspectingPlaylistVideos = true;
          scrollToBottom();
          await new Promise(resolve => {
            unwatchInspection = this.$watch(
              () => this.isInspectingPlaylistVideos,
              isInspecting => {
                if (!isInspecting) {
                  unwatchInspection();
                  resolve(true);
                }
              }
            );
          });
        };

        this.error = "";
        if (countVideosTotal <= 100) {
          if (!isVideosMatch()) {
            await startInspecting();
          }
        } else {
          await startInspecting();
        }

        this.setAllIndividualDownloadability(true);
        this.toggleCheckboxes(true);
        this.toggleDownload();
      },
      toggleCheckboxes(isAllChecked?: boolean | Event) {
        this.isAllChecked =
          typeof isAllChecked === "boolean" ? isAllChecked : !this.isAllChecked;
        this.getCheckboxes().forEach(
          (elCheckbox: HTMLInputElement) =>
            (elCheckbox.checked = this.isAllChecked)
        );
      },
      setAllIndividualDownloadability(isDownloadable) {
        for (const videoId in gDownloadContainers) {
          gDownloadContainers[videoId].isDownloadable = isDownloadable;
        }
      },
      disableAllCheckboxes(isDisable: boolean) {
        this.getCheckboxes().forEach(
          (elCheckbox: HTMLInputElement) => (elCheckbox.disabled = isDisable)
        );
      }
    },
    created() {
      const elVideosContainer = getVideosContainer();

      gMutationObserverPlaylistProgress = new MutationObserver(() => {
        this.countVideosDownloaded = document.querySelectorAll(
          `
          #contents progress[value="1"][data-download-type="video+audio"][data-progress-type="ffmpeg"],
          #contents progress[value="1"][data-download-type="audio"],
          #contents progress[value="1"][data-download-type="video"]
          `
        ).length;
      });
      gMutationObserverPlaylistProgress.observe(elVideosContainer, {
        attributes: true,
        subtree: true,
        attributeFilter: ["value"]
      });

      gMutationObserverPlaylistVideoReadiness = new MutationObserver(
        (_, observer) => {
          const stopInspecting = () => {
            observer.disconnect();
            scrollTo({ top: 0 });
            this.isInspectingPlaylistVideos = false;
            this.isStartedDownloadAll = true;
          };

          if (this.isCancelDownloadALl) {
            this.isInspectingPlaylistVideos = false;
            this.isStartedDownloadAll = false;
            observer.disconnect();
            return;
          }

          const isStillLoading = isElementVisible(
            document.querySelector("ytd-continuation-item-renderer")
          );

          if (countVideosTotal <= 100) {
            if (isVideosMatch()) {
              stopInspecting();
            }
            return;
          }

          scrollToBottom();
          if (isStillLoading || !isVideosMatch()) {
            return;
          }

          stopInspecting();
        }
      );

      this.tooltipDownloadDetails = this.getTooltipDownloadDetails();

      elVideosContainer.addEventListener("change", onCheckboxUpdate);
    }
  });
}

function isIdExists(videoId) {
  return gDownloadPlaylist.videoIdsToDownload.includes(videoId);
}

function addListeners() {
  gPorts.main.onDisconnect.addListener(() => {
    gDownloadPlaylist.isPortDisconnected = true;

    for (const videoId in gDownloadContainers) {
      const downloadContainer = gDownloadContainers[videoId];
      downloadContainer.isPortDisconnected = true;
      downloadContainer.isDownloadable = false;
      downloadContainer.progress = 0;
      downloadContainer.progressType = "";
      getCheckbox(videoId).disabled = true;
    }
  });

  chrome.runtime.onMessage.addListener(
    ({ updateProgress: { videoId, progress, progressType, isRemoved } }) => {
      const downloadContainer = gDownloadContainers[videoId];

      if (isRemoved) {
        downloadContainer.progress = 0;
        downloadContainer.progressType =
          downloadContainer.downloadType === "video+audio"
            ? ""
            : downloadContainer.downloadType;

        downloadContainer.isDoneDownloading = false;
        downloadContainer.isDownloadable = true;
        downloadContainer.isStartedDownload = false;
        return;
      }

      downloadContainer.progress = progress;
      downloadContainer.progressType = progressType;
      downloadContainer.isDoneDownloading = progress === 1;
      downloadContainer.isStartedDownload = true;

      if (progress === 1) {
        downloadContainer.isQueued = false;
      }
    }
  );

  function setVideoQualities(type: "custom" | "best", options: Options) {
    for (const videoId in gDownloadContainers) {
      const downloadContainer = gDownloadContainers[videoId];
      const iQuality =
        type === "best"
          ? 0
          : downloadContainer.getIVideoByQuality(options.videoQuality);
      downloadContainer.video =
        downloadContainer.videos?.[iQuality] ?? downloadContainer.videos[0];
    }
  }

  chrome.storage.onChanged.addListener(changes => {
    const videoQueueCurrent = changes.videoQueue?.newValue as VideoQueue;
    if (videoQueueCurrent) {
      const videoQueuePrev = (changes.videoQueue?.oldValue ?? []) as VideoQueue;

      const videoQueuePlaylistCurrent: VideoQueue =
        videoQueueCurrent.filter(isIdExists);

      const videoQueuePlaylistPrevious: VideoQueue =
        videoQueuePrev.filter(isIdExists);

      const videoQueueDiff: VideoQueue = videoQueuePlaylistPrevious.filter(
        videoId => !videoQueuePlaylistCurrent.includes(videoId)
      );

      const isGainedVideoIds =
        videoQueuePlaylistCurrent.length >
        gDownloadPlaylist.videoIdsToDownload.length;

      if (!isGainedVideoIds && videoQueueDiff.length > 0) {
        gDownloadPlaylist.videoIdsToDownload =
          gDownloadPlaylist.videoIdsToDownload.filter(
            videoId => !videoQueueDiff.includes(videoId)
          );

        if (gDownloadPlaylist.videoIdsToDownload.length === 0) {
          gDownloadPlaylist.disableAllCheckboxes(false);
          gDownloadPlaylist.isStartedDownload = false;
          gDownloadPlaylist.isStartedDownloadAll = false;
        }
      }

      videoQueueDiff.forEach(videoId => {
        const downloadContainer = gDownloadContainers[videoId];
        downloadContainer.isStartedDownload = false;
        downloadContainer.isQueued = false;
        downloadContainer.isDoneDownloading = false;
        getCheckbox(videoId).checked = false;

        if (
          getProgressBar(videoId).dataset.progressType !== "ffmpeg" ||
          downloadContainer.progress < 1
        ) {
          downloadContainer.progress = 0;
        }
      });

      videoQueueCurrent.forEach((videoId, i) => {
        const downloadContainer = gDownloadContainers[videoId];
        if (!downloadContainer) {
          return;
        }

        downloadContainer.isStartedDownload = i === 0;
        downloadContainer.isQueued = !downloadContainer.isStartedDownload;
        downloadContainer.isDoneDownloading = false;
        if (downloadContainer.isQueued) {
          downloadContainer.progress = 0;
          downloadContainer.progressType = "";
        }

        if (
          getProgressBar(videoId).dataset.progressType !== "ffmpeg" ||
          downloadContainer.progress < 1
        ) {
          downloadContainer.progress = 0;
          downloadContainer.progressType =
            downloadContainer.downloadType === "video+audio"
              ? ""
              : downloadContainer.downloadType;
        }
      });
      return;
    }

    const musicListCurrent = changes.musicList?.newValue as MusicList;
    if (musicListCurrent) {
      const musicListPrev = (changes.musicList?.oldValue ?? []) as MusicList;

      const musicListPlaylistCurrent: MusicList =
        musicListCurrent.filter(isIdExists);

      const musicListPlaylistPrevious: MusicList =
        musicListPrev.filter(isIdExists);

      const musicListDiff: MusicList = musicListPlaylistPrevious.filter(
        videoId => !musicListPlaylistCurrent.includes(videoId)
      );
      const isGainedVideoIds =
        musicListPlaylistCurrent.length >
        gDownloadPlaylist.videoIdsToDownload.length;

      if (!isGainedVideoIds && musicListDiff.length > 0) {
        gDownloadPlaylist.videoIdsToDownload =
          gDownloadPlaylist.videoIdsToDownload.filter(
            videoId => !musicListDiff.includes(videoId)
          );
      }

      musicListDiff.forEach(videoId => {
        const downloadContainer = gDownloadContainers[videoId];

        if (downloadContainer.progress < 1) {
          downloadContainer.isDoneDownloading = false;
          downloadContainer.progress = 0;
        } else {
          downloadContainer.isDoneDownloading = true;
        }
      });

      musicListCurrent.forEach(videoId => {
        const downloadContainer = gDownloadContainers[videoId];
        if (!downloadContainer) {
          return;
        }

        downloadContainer.isDoneDownloading = true;
        downloadContainer.progress = 0;
      });
      return;
    }

    const videoOnlyListCurrent = changes.videoOnlyList
      ?.newValue as VideoOnlyList;
    if (videoOnlyListCurrent) {
      const videoOnlyListPrev = (changes.videoOnlyList?.oldValue ??
        []) as VideoOnlyList;

      const videoOnlyListPlaylistCurrent: VideoOnlyList =
        videoOnlyListCurrent.filter(isIdExists);

      const videoOnlyListPlaylistPrevious: VideoOnlyList =
        videoOnlyListPrev.filter(isIdExists);

      const videoOnlyListDiff: VideoOnlyList =
        videoOnlyListPlaylistPrevious.filter(
          videoId => !videoOnlyListPlaylistCurrent.includes(videoId)
        );
      const isGainedVideoIds =
        videoOnlyListPlaylistCurrent.length >
        gDownloadPlaylist.videoIdsToDownload.length;

      if (!isGainedVideoIds && videoOnlyListDiff.length > 0) {
        gDownloadPlaylist.videoIdsToDownload =
          gDownloadPlaylist.videoIdsToDownload.filter(
            videoId => !videoOnlyListDiff.includes(videoId)
          );
      }

      videoOnlyListDiff.forEach(videoId => {
        const downloadContainer = gDownloadContainers[videoId];

        if (downloadContainer.progress < 1) {
          downloadContainer.isDoneDownloading = false;
          downloadContainer.progress = 0;
        } else {
          downloadContainer.isDoneDownloading = true;
        }
      });

      videoOnlyListCurrent.forEach(videoId => {
        const downloadContainer = gDownloadContainers[videoId];
        if (!downloadContainer) {
          return;
        }

        downloadContainer.isDoneDownloading = true;
        downloadContainer.progress = 0;
      });
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
        gDownloadPlaylist.extAudio = options.ext.audio;
        gDownloadPlaylist.extVideo = options.ext.video;
        gDownloadPlaylist.extAudiolessVideo = options.ext.video;
        return;
      }

      if (optionChanged === "videoQualityMode") {
        const { videoQualityMode } = options;
        if (videoQualityMode === "best") {
          setVideoQualities("best", options);
          return;
        }

        if (videoQualityMode === "custom") {
          setVideoQualities("custom", options);
        }
        return;
      }

      if (optionChanged === "videoQuality") {
        setVideoQualities("custom", options);
      }
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

  const elVideoNumbersContainers = await getElementsEventually(
    "#index-container"
  );

  const elVideoItems = [...document.querySelectorAll("#meta")].filter(
    isElementVisible
  );

  gDownloadContainers = {};

  addListeners();

  for (let i = 0; i < elVideoItems.length; i++) {
    promiseHtmls[i].then(async html => {
      const videoData = await getVideoData(html);

      const isDownloadable = getIsDownloadable(videoData);
      if (!isDownloadable) {
        return;
      }

      const { videoId } = videoData.videoDetails;
      const formats =
        videoData.streamingData.adaptiveFormats ||
        videoData.streamingData.formats;

      gDownloadPlaylist.isPlaylistDownloadable = true;

      appendCheckbox({
        videoId,
        elVideoNumberContainer: elVideoNumbersContainers[i]
      });

      appendDownloadContainer({
        videoId,
        elVideoItem: elVideoItems[i]
      });

      const options = await getStoredOptions();

      const isMusic =
        videoData.microformat.playerMicroformatRenderer.category === "Music";

      const isDefault = gDownloadPlaylist.downloadTypeTotal === "default";
      const ext = (() => {
        if (!isDefault) {
          if (gDownloadPlaylist.downloadTypeTotal === "video+audio") {
            return gDownloadPlaylist.extVideo;
          }
          if (gDownloadPlaylist.downloadTypeTotal === "video") {
            return gDownloadPlaylist.extAudiolessVideo;
          }
          return gDownloadPlaylist.extAudio;
        }
        if (isMusic) {
          return options.ext.audio;
        }
        return options.ext.video;
      })();

      const downloadTypeDetected = (isMusic ? "audio" : "video+audio") as
        | "video"
        | "audio"
        | "video+audio";

      gDownloadContainers[videoId] = new Vue({
        el: `[data-ytdl-download-container="${videoId}"]`,
        components: {
          Icon,
          ErrorFileExtension,
          TabsDownloadTypes
        },
        data: {
          isStartedDownload: false,
          isDoneDownloading: false,
          isDownloadable:
            isDownloadable && !gDownloadPlaylist.isInspectingPlaylistVideos,
          progress: 0,
          progressType: "" as "" | "video" | "audio" | "video+audio",
          isQueued: false,
          isPortDisconnected: false,
          isRichOptions: false,
          downloadType: isDefault
            ? downloadTypeDetected
            : gDownloadPlaylist.downloadTypeTotal,
          downloadTypeInitial: downloadTypeDetected,
          filename: videoData.videoDetails.title,
          ext,
          videos: [] as AdaptiveFormatItem[],
          audios: [] as AdaptiveFormatItem[],
          video: null as AdaptiveFormatItem,
          audio: null as AdaptiveFormatItem,
          videoUrl: "",
          audioUrl: "",
          icons
        },
        template: `
          <section class="ytdl-container ytdl-container--playlist-single-video"
                   @click.stop=""
                   data-ytdl-download-container="${videoId}"
                   ref="container">
          <div class="ytdl-action-buttons">
            <div class="ytdl-tooltip">
              <button @click="toggleDownload" :disabled="!isDownloadable" class="ytdl-action-buttons__button">
                <Icon :type="currentDownloadIcon" class="ytdl-action-buttons__action-icon" />
                {{ textButton }}
              </button>
              <span class="ytdl-tooltip__text" v-if="isDownloadable">{{ tooltipDownloadDetails }}</span>
            </div>

            <div class="ytdl-tooltip">
              <button class="ytdl-action-buttons__button"
                      v-if="${getIsDownloadable(videoData)}"
                      @click="isRichOptions = !isRichOptions"
                      :disabled="!isDownloadable || isStartedDownload"
                      :class="{'ytdl-action-buttons__button--hover': isRichOptions}"
                      :aria-label="labelExpandButton">
                <Icon type="expand" />
              </button>
              <span class="ytdl-tooltip__text" v-if="isDownloadable && !isStartedDownload">
                {{ labelExpandButton }}
              </span>
            </div>
          </div>

          <transition name="slide-rich-options">
            <div class="ytdl-container__rich-options-wrapper ytdl-container__rich-options-wrapper--in-place"
                 v-if="isRichOptions">
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

                <button @click="isRichOptions = false"
                        :disabled="!isDownloadable"
                        class="ytdl-container__rich-options__action-button">
                  CLOSE
                </button>
              </div>
            </div>
          </transition>

          <div class="ytdl-tooltip ytdl-tooltip--top-left">
            <progress :value="progress"
                      :data-progress-type="progressType"
                      :data-download-type="downloadType"></progress>
            <span v-show="isShowProgress" class="ytdl-tooltip__text">{{ tooltipProgress }}</span>
          </div>
          </section>
        `,
        watch: {
          async downloadType(type: "audio" | "video++audio" | "video") {
            const extOpt = (await getStoredOption(
              "ext"
            )) as OptionFileExtension;
            this.progress = 0;
            this.setCheckboxParams();

            if (type === "audio") {
              this.ext = extOpt.audio;
              return;
            }

            this.audio = this.audios[0];
            this.ext = extOpt.video;
          },
          isPortDisconnected() {
            this.isRichOptions = false;
          },
          isStartedDownload(isStarted) {
            if (isStarted) {
              this.isRichOptions = false;
            }
          },
          video(video: AdaptiveFormatItem) {
            this.videoUrl = video.url;
          },
          audio(audio: AdaptiveFormatItem) {
            this.audioUrl = audio.url;
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
            return formats.sort((a, b) => b.bitrate - a.bitrate);
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
                  ? this.videoQuality(this.video) + "p"
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
            const isQueued =
              gDownloadPlaylist.videoIdsToDownload.includes(videoId);
            if (!this.isStartedDownload || isQueued) {
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
              videoId,
              videoData,
              isOverride: true
            });
          },
          videoQuality(video?: AdaptiveFormatItem) {
            let videoHeight, videoWidth;
            if (!video) {
              ({ videoHeight, videoWidth } = document.querySelector("video"));
            } else {
              ({ height: videoHeight, width: videoWidth } = video);
            }
            return Math.min(videoHeight, videoWidth);
          },
          setCheckboxParams() {
            getCheckbox(videoId).dataset.ytdlPlaylistCheckboxDownloadType =
              this.downloadType;

            gDownloadPlaylist.setTooltipDownloadDetails();
          },
          getVideoQuality(video: AdaptiveFormatItem): number {
            return Math.min(video.height, video.width);
          },
          getIVideoByQuality(quality: number) {
            return this.videos.findIndex(
              (video: AdaptiveFormatItem) =>
                this.getVideoQuality(video) === quality
            );
          },
          updateMediaItem(type: "audio" | "video", urlToFind: string) {
            this[type] = this[`${type}s`].find(({ url }) => url === urlToFind);
          }
        },
        async created() {
          this.setCheckboxParams();
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

          this.video = this.videos[0];

          if (options.videoQualityMode === "best") {
            this.video = this.videos[0];
          } else if (options.videoQualityMode === "custom") {
            this.video =
              this.videos[this.getIVideoByQuality(options.videoQuality)];
          }
        },
        mounted() {
          setTimeout(() => {
            this.$refs.container.style.overflow = "visible";
            this.$refs.container.style.maxWidth = "400px";
            this.$refs.container.style.transform = "translateX(0)";
          }, 600);
        }
      });

      gPorts.main.postMessage({
        action: "insert-video-to-playlist",
        videoId
      });
    });
  }
}
