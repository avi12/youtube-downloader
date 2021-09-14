import { getVideoData } from "./yt-downloader-functions";
import {
  gCancelControllers,
  getIsDownloadable,
  gPorts
} from "./yt-downloader-content-script-initialize";
import {
  getElementsEventually,
  gExtToMime,
  gSupportedExts,
  isElementVisible
} from "./utils";
import Vue from "vue/dist/vue.min.js";
import type {
  AdaptiveFormatItem,
  MusicQueue,
  PlayerResponse,
  VideoOnlyQueue,
  VideoQueue
} from "./types";
import { icons } from "./icons";

export let gObserverPlaylist: MutationObserver;
let downloadContainers: { [videoId: string]: Vue };
let downloadPlaylist: Vue;

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
      videoIdsToDownload: [] as VideoQueue | VideoOnlyQueue | MusicQueue,
      icons
    },
    template: `
      <section id="ytdl-playlist-button-container" ref="container">
      <button @click="toggleCheckbox"
              :disabled="isPortDisconnected || isStartedDownload"
              :class="{'ytdl-download-icon-undownloadable': isPortDisconnected}"
              class="ytdl-download-button"
              id="ytdl-toggle-checkbox">
        <span v-html="iconToggle" class="ytdl-download-icon"></span> TOGGLE ALL
      </button>
      <button @click="toggleDownload" :disabled="isPortDisconnected" class="ytdl-download-button">
        <span :class="{'ytdl-download-icon-undownloadable': isPortDisconnected}"
              v-html="currentDownloadIcon"
              class="ytdl-download-icon"></span>{{ textButton }}
      </button>
      <transition-group name="slide-short" tag="div">
        <div key="count"
             v-if="isStartedDownload && countVideosToDownload > 0"
             class="ytdl--size-medium ytdl--text-color-default">
          Downloaded {{ countVideosDownloaded }} out of {{ countVideosToDownload }} video{{ countVideosToDownload === 1 ? "" : "s" }}
        </div>
        <div key="error" v-if="error" class="ytdl--error ytdl--size-medium">{{ error }}</div>
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
      },
      currentDownloadIcon() {
        switch (this.textButton) {
          case "RELOAD TO DOWNLOAD":
            return this.icons.notDownloadable;

          case "CANCEL":
            return this.icons.cancelDownload;

          default:
            return this.icons.download;
        }
      },
      iconToggle() {
        return this.isAllChecked ? icons.toggleOn : icons.toggleOff;
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
      async toggleDownload() {
        this.videoIdsToDownload = this.getVideoIdsToDownload();
        const isNoVideosSelected = this.videoIdsToDownload.length === 0;
        if (isNoVideosSelected) {
          this.error = "Select at least one video";
          return;
        }
        this.error = "";

        this.isDoneDownloading = false;
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

      gObserverPlaylist = new MutationObserver(() => {
        this.countVideosDownloaded = document.querySelectorAll(
          `
          #contents progress[value="1"][data-download-type="video+audio"][data-progress-type="ffmpeg"],
          #contents progress[value="1"][data-download-type="audio"],
          #contents progress[value="1"][data-download-type="video"]
          `
        ).length;
      });
      gObserverPlaylist.observe(elVideosContainer, {
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

      const isDownloadable = getIsDownloadable(videoData);
      if (!isDownloadable) {
        return;
      }

      const { videoId } = videoData.videoDetails;

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

      const ext = isMusic ? "mp3" : "mp4";

      downloadContainers[videoId] = new Vue({
        el: `[data-ytdl-download-container="${videoId}"]`,
        data: {
          isStartedDownload: false,
          isDoneDownloading: false,
          isDownloadable,
          progress: 0,
          progressType: "" as "" | "video" | "audio" | "video+audio",
          isQueued: false,
          isPortDisconnected: false,
          errorFilename: "",
          isRichOptions: false,
          downloadType: (isMusic ? "audio" : "video+audio") as
            | "video"
            | "audio"
            | "video+audio",
          filename: videoData.videoDetails.title,
          ext,
          videos: [] as AdaptiveFormatItem[],
          audios: [] as AdaptiveFormatItem[],
          videoUrl: "",
          audioUrl: "",
          icons
        },
        template: `
          <section class="ytdl-container-playlist-single-video"
                   @click.stop=""
                   data-ytdl-download-container="${videoId}"
                   ref="container">
          <div class="ytdl-container-playlist-single-video__buttons">
            <button @click="toggleDownload" :disabled="!isDownloadable" class="ytdl-download-button ytdl-download-button--download">
              <span class="ytdl-download-icon"
                    :class="{'ytdl-download-icon-undownloadable': !isDownloadable}"
                    v-html="currentDownloadIcon"></span>{{ textButton }}
            </button>
            <button class="ytdl-download-button ytdl-download-button--expand"
                    v-if="isDownloadable"
                    @click="isRichOptions = !isRichOptions"
                    :class="{'ytdl-download-icon-undownloadable': !isDownloadable || isStartedDownload}"
                    :disabled="!isDownloadable || isStartedDownload">
              ${icons.expand}
            </button>
          </div>

          <progress :value="progress" :data-progress-type="progressType" :data-download-type="downloadType"></progress>

          <transition name="slide-rich-options">
            <div class="ytdl-rich-options" data-video-id="${videoId}" v-if="isRichOptions">
              <div class="ytdl-rich-options__content">
                <div class="ytdl-tabs-buttons">
                  <button @click="downloadType = 'video+audio'"
                          class="ytdl-tab__button"
                          :class="{'ytdl-tab__button--selected': downloadType === 'video+audio' || downloadType === 'video'}">
                    Video
                  </button>
                  <button @click="downloadType = 'audio'"
                          class="ytdl-tab__button"
                          :class="{'ytdl-tab__button--selected': downloadType === 'audio'}">
                    Audio
                  </button>
                </div>

                <div class="ytdl-tab-content">
                  <div v-if="downloadType === 'audio'">
                    <label for="ytdl-audio-quality">Audio quality</label>
                    <div>
                      <select id="ytdl-audio-quality" v-model="audioUrl">
                        <option :value="audio.url"
                                v-for="(audio, i) of audios"
                                :key="audio.url">{{ Math.floor(audio.bitrate / 1000) }} kbps {{ i === 0 ? "(best)" : "" }}
                        </option>
                      </select>
                    </div>
                    <div style="margin-top: 10px;">
                      <label for="ytdl-filename">Filename</label>
                      <div>
                        <input autocomplete="off"
                               type="text"
                               id="ytdl-filename"
                               :class="{'ytdl-filename--error': errorFilename}"
                               v-model="filenameOutput"
                               class="ytdl-filename">
                        <transition name="slide">
                          <div class="ytdl--error" v-if="errorFilename">
                            {{ errorFilename }}
                            <div>Supported file extensions: <span class="ytdl-file-extensions">
                                ${gSupportedExts.audio.join(", ")}
                              </span>
                            </div>
                          </div>
                        </transition>
                      </div>
                    </div>
                  </div>
                  <div v-else>
                    <div style="margin-bottom: 10px; ">
                      <input type="checkbox"
                             id="ytdl-video-include-audio"
                             checked
                             @input="e => downloadType = e.target.checked ? 'video+audio' : 'video'" />
                      <label for="ytdl-video-include-audio">Include audio (best quality)</label>
                    </div>
                    <label for="ytdl-video-quality">Video quality</label>
                    <div>
                      <select id="ytdl-video-quality" v-model="videoUrl">
                        <option :value="video.url"
                                v-for="(video, i) of videos"
                                :key="video.url">{{ video.height }}p {{ video.fps }} FPS {{ i === 0 ? "(best)" : "" }}
                        </option>
                      </select>
                    </div>
                    <div style="margin-top: 10px;">
                      <label for="ytdl-filename">Filename</label>
                      <div>
                        <input type="text"
                               autocomplete="off"
                               id="ytdl-filename"
                               :class="{'ytdl-filename--error': errorFilename}"
                               v-model="filenameOutput"
                               class="ytdl-filename">
                        <transition name="slide">
                          <div class="ytdl--error" v-if="errorFilename">
                            <span v-html="errorFilename"></span>
                            <div>Supported file extensions: <span class="ytdl-file-extensions">
                                ${gSupportedExts.video.join(", ")}
                              </span>
                            </div>
                          </div>
                        </transition>
                      </div>
                    </div>
                  </div>

                  <button @click="isRichOptions = false"
                          :disabled="!isDownloadable"
                          class="ytdl-rich-options__download-button">
                    CLOSE
                  </button>
                </div>
              </div>
            </div>
          </transition>

          </section>
        `,
        watch: {
          ext(ext) {
            if (this.downloadType === "audio") {
              if (gExtToMime.audio[ext]) {
                this.errorFilename = "";
                return;
              }

              this.errorFilename = `Not supporting audio extension: <b>${ext}</b>`;
              return;
            }

            if (gExtToMime.video[ext]) {
              this.errorFilename = "";
              return;
            }

            this.errorFilename = `Not supporting video extension: <b>${ext}</b>`;
          },
          downloadType(type) {
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
          },
          errorFilename(error) {
            this.isDownloadable = !error;
          },
          isStartedDownload(isStarted) {
            if (isStarted) {
              this.isRichOptions = false;
            }
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
          }
        },
        created() {
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
          setTimeout(() => {
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
