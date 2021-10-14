import Vue from "vue/dist/vue.min.js";
import { icons } from "./icons";
import { gExtToMime, gSupportedExts } from "./utils";
import type { AdaptiveFormatItem } from "./types";
import type { PropType } from "vue";

export const Icon = Vue.component("Icon", {
  props: {
    type: String
  },
  template: `
    <svg width="24" height="24">
    <use :href="'#ytdl-svg__' + type" />
    </svg>
  `
});

export const IconLoader = Vue.component("IconLoader", {
  data() {
    return { icons };
  },
  template: `
    <svg v-show="false">
    <symbol v-for="svg in icons"
            :key="svg + getPageId()"
            v-html="getSvgContent(svg)"
            :id="getSvgId(svg)"
            width="24"
            height="24"></symbol>
    </svg>
  `,
  methods: {
    getSvgContent(svg: string): string {
      return svg.split("\n").slice(0, -1).join("\n");
    },
    getSvgId(svg: string): string {
      const elSvg = new DOMParser().parseFromString(svg, "text/xml");
      return elSvg.firstElementChild.id;
    },
    getPageId(): string {
      const searchParams = new URLSearchParams(location.search);
      return searchParams.get("v") || searchParams.get("list");
    }
  }
});

export const ErrorFileExtension = Vue.component("ErrorFileExtension", {
  props: {
    extsSupportedForType: String as PropType<"audio" | "video">,
    ext: String
  },
  data() {
    return { gSupportedExts, gExtToMime };
  },
  template: `
    <transition name="slide">
    <div class="ytdl-container__filename-error" v-if="!gExtToMime[extsSupportedForType][ext]">
      Unsupported for {{ extsSupportedForType }}: <b>{{ ext }}</b>
      <div class="ytdl-container__spacer--margin-top"></div>
      <div class="ytdl-container__filename-error--supported-extensions">
        Supported ones: <b>{{ gSupportedExts[extsSupportedForType].join(", ") }}</b>
      </div>
      <div class="ytdl-container__spacer--margin-top"></div>
    </div>
    </transition>
  `
});

export const TabsDownloadTypes = Vue.component("TabsDownloadTypes", {
  props: {
    downloadType: String as PropType<"audio" | "video" | "video+audio">,
    audioUrl: String,
    videoUrl: String,
    audios: Array as PropType<AdaptiveFormatItem[]>,
    videos: Array as PropType<AdaptiveFormatItem[]>,
    isStartedDownload: Boolean,
    ext: String,
    filenameOutput: String,
    audioBitrate: Number,
    extsSupportedForType: String as PropType<"audio" | "video">
  },
  template: `
    <div class="ytdl-container__tab-content">
    <div class="ytdl-container__tabs-buttons">
      <button :class="{'ytdl-container__tab-button--selected': downloadType === 'video+audio' || downloadType === 'video'}"
              :disabled="isStartedDownload"
              class="ytdl-container__tab-button"
              @click="$emit('change-download-type', 'video+audio')">
        Video
      </button>
      <button :class="{'ytdl-container__tab-button--selected': downloadType === 'audio'}"
              :disabled="isStartedDownload"
              class="ytdl-container__tab-button"
              @click="$emit('change-download-type', 'audio')">
        Audio
      </button>
    </div>

    <div v-if="downloadType === 'audio'">
      <label> Audio quality
        <br />
        <select class="ytdl-container__quality-option-input" @input="$emit('change-audio-url', $event.target.value)">
          <option v-for="(audio, i) of audios" :key="audio.url" :value="audio.url">
            {{ displayBitrate(audio.bitrate) }} kbps {{ i === 0 ? "(best)" : "" }}
          </option>
        </select> </label>
    </div>
    <div v-else>
      <label>
        <!-- -->
        <input :checked="downloadType === 'video+audio'"
               class="ytdl-container__video-option-audio-input"
               type="checkbox"
               @input="e => $emit('change-download-type', e.target.checked ? 'video+audio' : 'video')" /> Include audio (best quality)
      </label>

      <div class="ytdl-container__spacer--margin-top"></div>
      <label> Video quality
        <br />
        <select class="ytdl-container__video-option-quality-input"
                :value="videoUrl"
                @input="$emit('change-video-url', $event.target.value)">
          <option v-for="(video, i) of videos" :key="video.url" :value="video.url">
            {{ video.height }}p {{ video.fps }} FPS {{ i === 0 ? "(best)" : "" }}
          </option>
        </select> </label>
    </div>

    <div class="ytdl-container__spacer--margin-top"></div>

    <label>Filename
      <br />
      <input :disabled="isStartedDownload"
             :value="filenameOutput"
             autocomplete="off"
             class="ytdl-container__filename-option-input"
             type="text"
             @input="$emit('change-filename-output', $event.target.value)" /> </label>

    <ErrorFileExtension :ext="ext" :exts-supported-for-type="extsSupportedForType" />
    </div>
  `,
  methods: {
    displayBitrate(bitrate) {
      return Math.floor(bitrate / 1000);
    }
  }
});
