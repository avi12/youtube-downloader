import { defineLayer } from "wxt-module-layers";

export default defineLayer({
  entrypoints: {
    "youtube.content": "entrypoints/youtube.content/index.ts",
    "youtube-main.content": "entrypoints/youtube-main.content/index.ts",
    "page-sabr-fetch.content": "entrypoints/page-sabr-fetch.content.ts",
    "iframe-mute.content": "entrypoints/iframe-mute.content.ts",
    "visibility-spoof.content": "entrypoints/visibility-spoof.content.ts"
  }
});
