import { resolve } from "node:path";
import { defineConfig } from "wxt";

const FFMPEG_WASM_DEST = "ffmpeg/ffmpeg-core.wasm";
const FFMPEG_WASM_SRC = "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm";

export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  modules: ["@wxt-dev/module-svelte"],
  manifestVersion: 3,
  manifest: {
    name: "FFmpeg for YouTube",
    description: "Run FFmpeg against a YouTube URL straight from the popup",
    permissions: ["activeTab", "downloads", "scripting", "declarativeNetRequestWithHostAccess", "clipboardRead"],
    host_permissions: ["https://*.youtube.com/*", "https://*.googlevideo.com/*", "https://cdn.jsdelivr.net/*", "https://i.ytimg.com/*"],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    minimum_chrome_version: "109.0"
  },
  zip: {
    artifactTemplate: "youtube-ffmpeg-lite-{{version}}-{{browser}}.zip",
    excludeSources: ["user-profiles/**", ".output/**", ".chrome-for-testing/**", ".wxt/**", ".dev-certs/**", ".fallow/**", "keys/**"]
  },
  hooks: {
    "prepare:publicPaths"(_, paths) {
      paths.push(FFMPEG_WASM_DEST);
    },
    "build:publicAssets"(_, assets) {
      assets.push({ absoluteSrc: resolve(FFMPEG_WASM_SRC), relativeDest: FFMPEG_WASM_DEST });
    }
  }
});
