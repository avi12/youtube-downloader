import Vue from "vue/dist/vue.js";
import { icons } from "./icons";
import { gExtToMime, gSupportedExts } from "./utils";

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
    extsSupportedForType: String,
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
