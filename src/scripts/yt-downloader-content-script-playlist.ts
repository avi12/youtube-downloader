import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import {
  getCompatibleFilename,
  getElementsEventually,
  gExtToMime,
  gSupportedExts,
  isElementVisible
} from "./utils";
import Vue from "vue/dist/vue.js";
import type {
  AdaptiveFormatItem,
  MusicQueue,
  PlayerResponse,
  VideoOnlyQueue,
  VideoQueue
} from "./types";
import { icons } from "./icons";

export let gMutationObserverPlaylistProgress: MutationObserver;
export let gMutationObserverPlaylistVideoReadiness: MutationObserver;
let downloadContainers: { [videoId: string]: Vue };
let downloadPlaylist: Vue;

function onCheckboxUpdate(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.matches("[data-ytdl-playlist-checkbox]")) {
    return;
  }

  downloadPlaylist.setTooltipDownloadDetails();
  downloadPlaylist.error = "";
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
  elCheckboxContainer.className = "ytdl-playlist-checkbox-container";
  elCheckboxContainer.style.width = "0";

  const disabled = downloadPlaylist.isStartedDownload ? "disabled" : "";
  elCheckboxContainer.innerHTML = `<input type="checkbox" data-ytdl-playlist-checkbox="${videoId}" ${disabled} />`;
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

  const getVideosContainer = (): HTMLDivElement =>
    document.querySelector("#contents");

  const scrollToBottom = () =>
    scrollBy({ top: getVideosContainer().clientHeight });

  elDownloadPlaylistContainer.insertBefore(
    elDownloadPlaylist,
    elDownloadPlaylistContainer.querySelector("#play-buttons")
  );

  let unwatchInspection;

  downloadPlaylist = new Vue({
    el: `#${elDownloadPlaylist.id}`,
    data: {
      isStartedDownload: false,
      isStartedDownloadAll: false,
      progress: 0,
      error: "",
      isAllChecked: false,
      countVideosToDownload: -1,
      countVideosDownloaded: 0,
      isPortDisconnected: false,
      videoIdsToDownload: [] as VideoQueue | VideoOnlyQueue | MusicQueue,
      icons,
      tooltipDownloadDetails: "",
      isInspectingPlaylistVideos: false,
      isCancelDownloadALl: false,
      isCanDownloadAll: false,
      isLoadedPlaylistContainer: false,
      isRichOptions: false,
      extVideo: "mp4",
      extAudiolessVideo: "mp4",
      extAudio: "mp3",
      downloadTypeTotal: "default" as
        | "default"
        | "video+audio"
        | "video"
        | "audio",
      gExtToMime
    },
    template: `
      <transition name="slide">
      <section v-show="isLoadedPlaylistContainer"
               id="${elDownloadPlaylist.id}"
               class="ytdl-action-buttons ytdl-container ytdl-container__playlist">

        <!-- More options button -->
        <div class="ytdl-tooltip">
          <button :aria-label="labelExpandButton"
                  :disabled="isPortDisconnected || !isSupportedExts || isStartedDownload || isStartedDownloadAll"
                  class="ytdl-action-buttons__button tooltip-bottom"
                  @click="isRichOptions = !isRichOptions">
            <span class="ytdl-action-buttons__action--icon" v-html="icons.options"></span> PLAYLIST DOWNLOAD OPTIONS
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
                <label for="rich-options--download-type-video+audio">
                  <!-- -->
                  <input v-model="downloadTypeTotal" name="download-type" type="radio" value="video+audio">Video</label>
                <!-- -->
                <input autocomplete="off"
                       id="rich-options--download-type-video+audio"
                       type="text"
                       v-model="extVideo"
                       @focus="downloadTypeTotal = 'video+audio'" />
                <!-- -->
                <!-- -->

                <transition name="slide">
                  <div class="ytdl-container__filename-error" v-if="!gExtToMime.video[extVideo]">
                    Unsupported for video: <b>{{ extVideo }}</b>
                    <div class="ytdl-container__spacer--margin-top"></div>
                    <div class="ytdl-container__filename-error--supported-extensions">
                      Supported: <b>${gSupportedExts.video.join(", ")}</b>
                    </div>
                  </div>
                </transition>

                <label for="rich-options--download-type-audio">
                  <!-- -->
                  <input v-model="downloadTypeTotal" name="download-type" type="radio" value="audio">Audio</label>
                <!-- -->
                <input autocomplete="off"
                       id="rich-options--download-type-audio"
                       type="text"
                       v-model="extAudio"
                       @focus="downloadTypeTotal = 'audio'" />

                <transition name="slide">
                  <div class="ytdl-container__filename-error" v-if="!gExtToMime.audio[extAudio]">
                    Unsupported for audio: <b>{{ extAudio }}</b>
                    <div class="ytdl-container__spacer--margin-top"></div>
                    <div class="ytdl-container__filename-error--supported-extensions">
                      Supported: <b>${gSupportedExts.audio.join(", ")}</b>
                    </div>
                  </div>
                </transition>
                <!-- -->
                <!-- -->

                <!-- -->
                <label for="rich-options--download-type-video">
                  <!-- -->
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

                <transition name="slide">
                  <div class="ytdl-container__filename-error" v-if="!gExtToMime.video[extAudiolessVideo]">
                    Unsupported for video: <b>{{ extAudiolessVideo }}</b>
                    <div class="ytdl-container__spacer--margin-top"></div>
                    <div class="ytdl-container__filename-error--supported-extensions">
                      Supported: <b>${gSupportedExts.video.join(", ")}</b>
                    </div>
                  </div>
                </transition>
                <!-- -->
                <!-- -->

                <!-- -->
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
          <span v-html="icons.downloadAll"></span> {{ isStartedDownloadAll ? "DON'T" : "" }} DOWNLOAD ALL WHEN READY
        </button>

        <!-- Toggle all -->
        <button id="ytdl-toggle-checkbox"
                :disabled="isPortDisconnected || !isSupportedExts || isStartedDownload || isStartedDownloadAll"
                class="ytdl-action-buttons__button"
                @click="toggleCheckboxes">
          <span v-html="iconToggle"></span> TOGGLE ALL
        </button>

        <!-- Download button -->
        <div class="ytdl-tooltip ytdl-tooltip--bottom-left">
          <button :disabled="isPortDisconnected || !isSupportedExts || isInspectingPlaylistVideos"
                  class="ytdl-action-buttons__button"
                  @click="toggleDownload">
            <span class="ytdl-download-icon" v-html="currentDownloadIcon"></span>{{ textButton }}
          </button>
          <span class="ytdl-tooltip__text"
                v-if="!isStartedDownload && !isInspectingPlaylistVideos">{{ tooltipDownloadDetails }}</span>
        </div>

        <transition-group name="slide-short" tag="div">
          <div v-if="isStartedDownload && countVideosToDownload > 0"
               key="count"
               class="ytdl--size-medium ytdl--text-color-default">
            Downloaded {{ countVideosDownloaded }} out of {{ countVideosToDownload }} video{{ countVideosToDownload === 1 ? "" : "s" }}
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
      isStartedDownload(isStarted: boolean) {
        this.getCheckboxes().forEach(
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
      isPortDisconnected() {
        this.isRichOptions = false;
      },
      downloadTypeTotal(downloadType) {
        const isDefault = downloadType === "default";
        for (const videoId in downloadContainers) {
          const downloadContainer = downloadContainers[videoId];
          downloadContainer.downloadType = isDefault
            ? downloadContainer.downloadTypeInitial
            : downloadType;
        }
      },
      isStartedDownloadAll(isStarted) {
        this.setAllIndividualDownloadability(!isStarted);
      },
      isInspectingPlaylistVideos() {
        this.isRichOptions = false;
      },
      extVideo(extVideo) {
        const isExists = gExtToMime.video[extVideo];
        for (const videoId in downloadContainers) {
          downloadContainers[videoId].ext = isExists ? extVideo : "mp4";
        }
      },
      extAudiolessVideo(extVideo) {
        const isExists = gExtToMime.video[extVideo];
        for (const videoId in downloadContainers) {
          downloadContainers[videoId].ext = isExists ? extVideo : "mp4";
        }
      },
      extAudio(extAudio) {
        const isExists = gExtToMime.audio[extAudio];
        for (const videoId in downloadContainers) {
          downloadContainers[videoId].ext = isExists ? extAudio : "mp3";
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
          return this.icons.notDownloadable;
        }

        if (this.textButton === "CANCEL") {
          return this.icons.cancelDownload;
        }

        return this.icons.download;
      },
      iconToggle() {
        return this.isAllChecked ? icons.toggleOn : icons.toggleOff;
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

        return this.gExtToMime.video[this.extAudiolessVideo];
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
          const downloadContainer = downloadContainers[videoId];
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

        this.countVideosToDownload = this.videoIdsToDownload.length;
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

        if (countVideosTotal <= 100) {
          if (!isVideosMatch()) {
            await startInspecting();
          }
        } else {
          await startInspecting();
        }

        this.toggleCheckboxes(true);
        this.toggleDownload();
      },
      toggleCheckboxes(isAllChecked?: boolean) {
        this.isAllChecked =
          isAllChecked !== undefined ? isAllChecked : !this.isAllChecked;
        this.getCheckboxes().forEach(
          (elCheckbox: HTMLInputElement) =>
            (elCheckbox.checked = this.isAllChecked)
        );
      },
      setAllIndividualDownloadability(isDownloadable) {
        for (const videoId in downloadContainers) {
          downloadContainers[videoId].isDownloadable = isDownloadable;
        }
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

      elVideosContainer.removeEventListener("change", onCheckboxUpdate);
      elVideosContainer.addEventListener("change", onCheckboxUpdate);
    },
    mounted() {
      this.isLoadedPlaylistContainer = true;
    }
  });
}

function isIdExists(videoId) {
  return downloadPlaylist.videoIdsToDownload.includes(videoId);
}

function addListeners() {
  gPorts.main.onDisconnect.addListener(() => {
    downloadPlaylist.isPortDisconnected = true;
    downloadPlaylist.isDownloadable = false;

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

  chrome.runtime.onMessage.addListener(({ updateProgress }) => {
    const { videoId, progress, progressType, isRemoved } = updateProgress;

    const downloadContainer = downloadContainers[videoId];
    if (!downloadContainer) {
      return;
    }

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

    if (progress === 1) {
      downloadContainer.isQueued = false;
    }
  });

  chrome.storage.onChanged.addListener(changes => {
    const videoQueueCurrent = changes.videoQueue?.newValue as VideoQueue;
    if (videoQueueCurrent) {
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
        downloadContainer.isDoneDownloading = false;
        downloadContainer.isQueued = false;

        const elProgress: HTMLProgressElement = document.querySelector(
          `[data-ytdl-download-container="${videoId}"] progress[data-progress-type]`
        );
        if (
          elProgress.dataset.progressType !== "ffmpeg" ||
          downloadContainer.progress < 1
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
        downloadContainer.isDoneDownloading = false;
        downloadContainer.progress = 0;
      });
      return;
    }

    const musicQueueCurrent = changes.musicQueue?.newValue as MusicQueue;
    if (musicQueueCurrent) {
      const musicQueuePlaylistCurrent: MusicQueue =
        musicQueueCurrent.filter(isIdExists);

      const musicQueuePlaylistPrevious: MusicQueue =
        changes.musicQueue.oldValue.filter(isIdExists);

      const musicQueueDiff: MusicQueue = musicQueuePlaylistPrevious.filter(
        videoId => !musicQueuePlaylistCurrent.includes(videoId)
      );
      const isGainedVideoIds =
        musicQueuePlaylistCurrent.length >
        downloadPlaylist.videoIdsToDownload.length;

      if (!isGainedVideoIds && musicQueueDiff.length > 0) {
        downloadPlaylist.videoIdsToDownload =
          downloadPlaylist.videoIdsToDownload.filter(
            videoId => !musicQueueDiff.includes(videoId)
          );
      }

      musicQueueDiff.forEach(videoId => {
        const downloadContainer = downloadContainers[videoId];
        downloadContainer.isDoneDownloading = false;

        if (downloadContainer.progress < 1) {
          downloadContainer.progress = 0;
        }
      });

      musicQueueCurrent.forEach(videoId => {
        const downloadContainer = downloadContainers[videoId];
        if (!downloadContainer) {
          return;
        }
        downloadContainer.isDoneDownloading = true;
        downloadContainer.progress = 0;
      });
      return;
    }

    const videoOnlyQueueCurrent = changes.videoOnlyQueue
      ?.newValue as VideoOnlyQueue;
    if (videoOnlyQueueCurrent) {
      const videoOnlyQueuePlaylistCurrent: VideoOnlyQueue =
        videoOnlyQueueCurrent.filter(isIdExists);

      const videoOnlyQueuePlaylistPrevious: VideoOnlyQueue =
        changes.videoOnlyQueue.oldValue.filter(isIdExists);

      const videoOnlyQueueDiff: VideoOnlyQueue =
        videoOnlyQueuePlaylistPrevious.filter(
          videoId => !videoOnlyQueuePlaylistCurrent.includes(videoId)
        );
      const isGainedVideoIds =
        videoOnlyQueuePlaylistCurrent.length >
        downloadPlaylist.videoIdsToDownload.length;

      if (!isGainedVideoIds && videoOnlyQueueDiff.length > 0) {
        downloadPlaylist.videoIdsToDownload =
          downloadPlaylist.videoIdsToDownload.filter(
            videoId => !videoOnlyQueueDiff.includes(videoId)
          );
      }

      videoOnlyQueueDiff.forEach(videoId => {
        const downloadContainer = downloadContainers[videoId];
        downloadContainer.isDoneDownloading = false;

        if (downloadContainer.progress < 1) {
          downloadContainer.progress = 0;
        }
      });

      videoOnlyQueueCurrent.forEach(videoId => {
        const downloadContainer = downloadContainers[videoId];
        if (!downloadContainer) {
          return;
        }
        downloadContainer.isDoneDownloading = true;
        downloadContainer.progress = 0;
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

  const elVideoNumbersContainers = await getElementsEventually(
    "#index-container"
  );

  const elVideoItems = [...document.querySelectorAll("#meta")].filter(
    isElementVisible
  );

  downloadContainers = {};

  addListeners();

  for (let i = 0; i < elVideoItems.length; i++) {
    promiseHtmls[i].then(async html => {
      const videoData = await getVideoData(html);

      const { videoId } = videoData.videoDetails;
      const isDownloadable = getIsDownloadable(videoData);
      if (!isDownloadable) {
        return;
      }

      appendCheckbox({
        videoId,
        elVideoNumberContainer: elVideoNumbersContainers[i]
      });

      appendDownloadContainer({
        videoId,
        elVideoItem: elVideoItems[i]
      });

      const isMusic =
        videoData.microformat.playerMicroformatRenderer.category === "Music";

      const isDefault = downloadPlaylist.downloadTypeTotal === "default";
      const ext = (() => {
        if (!isDefault) {
          if (downloadPlaylist.downloadTypeTotal === "video+audio") {
            return downloadPlaylist.extVideo;
          }
          if (downloadPlaylist.downloadTypeTotal === "video") {
            return downloadPlaylist.extAudiolessVIdeo;
          }
          return downloadPlaylist.extAudio;
        }
        if (isMusic) {
          return "mp3";
        }
        return "mp4";
      })();

      const downloadTypeDetected = (isMusic ? "audio" : "video+audio") as
        | "video"
        | "audio"
        | "video+audio";

      downloadContainers[videoId] = new Vue({
        el: `[data-ytdl-download-container="${videoId}"]`,
        data: {
          isStartedDownload: false,
          isDoneDownloading: false,
          isDownloadable:
            isDownloadable && !downloadPlaylist.isInspectingPlaylistVideos,
          progress: 0,
          progressType: "" as "" | "video" | "audio" | "video+audio",
          isQueued: false,
          isPortDisconnected: false,
          errorFilename: "",
          isRichOptions: false,
          downloadType: isDefault
            ? downloadTypeDetected
            : downloadPlaylist.downloadTypeTotal,
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
                <span class="ytdl-action-buttons__action-icon" v-html="currentDownloadIcon"></span> {{ textButton }}
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
                <span v-html="icons.expand"></span>
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
                        <option :value="audio.url" v-for="(audio, i) of audios" :key="audio.url">
                          {{ Math.floor(audio.bitrate / 1000) }} kbps {{ i === 0 ? "(best)" : "" }}
                        </option>
                      </select> </label>

                    <div class="ytdl-container__spacer--margin-top"></div>
                    <label> Filename
                      <br>
                      <input autocomplete="off"
                             type="text"
                             :class="{'ytdl-container__filename-option-input--error': errorFilename}"
                             v-model="filenameOutput"
                             class="ytdl-container__filename-option-input"> </label>
                  </div>
                  <div v-else>
                    <label> <input type="checkbox"
                                   checked
                                   @input="e => downloadType = e.target.checked ? 'video+audio' : 'video'" /> Include audio (best quality)
                    </label>

                    <div class="ytdl-container__spacer--margin-top"></div>
                    <label> Video quality
                      <br>
                      <select v-model="videoUrl">
                        <option :value="video.url"
                                v-for="(video, i) of videos"
                                :key="video.url">{{ video.height }}p {{ video.fps }} FPS {{ i === 0 ? "(best)" : "" }}
                        </option>
                      </select> </label>

                    <div class="ytdl-container__spacer--margin-top"></div>
                    <label> Filename
                      <br>
                      <input type="text"
                             autocomplete="off"
                             v-model="filenameOutput"
                             class="ytdl-container__filename-option-input">
                      <transition name="slide">
                        <div class="ytdl-container__filename-error" v-if="errorFilename">
                          Unsupported video extension: <b>{{ errorFilename }}</b>
                          <br>
                          Supported ones: <span class="ytdl-container__filename-error--supported-extensions">
                                ${gSupportedExts.video.join(", ")}
                              </span>
                        </div>
                      </transition>
                    </label>
                  </div>

                  <button @click="isRichOptions = false"
                          :disabled="!isDownloadable"
                          class="ytdl-container__rich-options__action-button">
                    CLOSE
                  </button>
                </div>
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
            this.setCheckboxParams();

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
          isStartedDownload(isStarted) {
            if (isStarted) {
              this.isRichOptions = false;
            }
          },
          videoUrl(urlNew) {
            this.video = this.videos.find(({ url }) => url === urlNew);
          },
          audioUrl(urlNew) {
            this.audio = this.audios.find(({ url }) => url === urlNew);
          }
        },
        computed: {
          textButton() {
            if (this.isPortDisconnected) {
              return "RELOAD TO DOWNLOAD";
            }

            if (downloadPlaylist.isStartedDownloadAll) {
              return "DOWNLOADING AS PLAYLIST";
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
              case "DOWNLOADING AS PLAYLIST":
              case "NOT DOWNLOADABLE":
                return this.icons.notDownloadable;

              case "DONE":
                return this.icons.downloadCompleted;

              case "QUEUED":
                return this.icons.downloadQueue;

              case "CANCEL":
                return this.icons.cancelDownload;

              default:
                return this.icons.download;
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
              strings.push(`Download in`);
            } else {
              strings.push(`Downloading`);
            }

            if (this.downloadType === "audio") {
              strings.push(this.audioBitrate, "kbps");
            } else {
              strings.push(
                this.videoQuality(this.video) + "p",
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
              strings.push(`(downloading ${this.progressType})`);
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
              downloadPlaylist.videoIdsToDownload.includes(videoId);
            if (!this.isStartedDownload || isQueued) {
              this.isDownloadable = false;
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
            const elCheckbox = document.querySelector(
              `[data-ytdl-playlist-checkbox="${videoId}"]`
            ) as HTMLInputElement;
            elCheckbox.dataset.ytdlPlaylistCheckboxDownloadType =
              this.downloadType;

            downloadPlaylist.setTooltipDownloadDetails();
          }
        },
        created() {
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

          this.video = this.videos[0];
          this.audio = this.audios[0];

          this.videoUrl = this.video.url;
          this.audioUrl = this.audio.url;
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
