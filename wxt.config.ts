import { resolve } from "node:path";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  modules: ["@wxt-dev/module-svelte"],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: "YouTube Downloader",
    description: "Download YouTube videos and audio directly from the page",
    permissions: [
      "cookies",
      "downloads",
      "storage",
      "tabs",
      "scripting",
      "webRequest",
      "declarativeNetRequest",
      "declarativeNetRequestWithHostAccess",
      ...(browser === "chrome" ? ["offscreen"] : [])
    ],
    host_permissions: [
      "https://www.youtube.com/*",
      "https://*.googlevideo.com/*",
      "https://i.ytimg.com/*",
      "http://localhost/*",
      "https://localhost/*"
    ],
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: { id: "youtube-downloader@avi12" }
      }
    }),
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    web_accessible_resources: [
      {
        resources: [
          ...(browser === "chrome" ? ["offscreen.html"] : [])
        ],
        matches: ["<all_urls>"]
      }
    ]
  }),
  vite: () => ({
    server: {
      strictPort: false,
      // Native fs events are unreliable on Windows; polling ensures file
      // changes are always detected by WXT's dev server watcher
      watch: { usePolling: true, interval: 500 }
    },
    build: { sourcemap: true }
  }),
  hooks: {
    "prepare:publicPaths"(_, paths) {
      paths.push(
        "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js",
        "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"
      );
    },
    "build:publicAssets"(_, assets) {
      for (const path of [
        "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js",
        "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"
      ]) {
        assets.push({ absoluteSrc: resolve(path), relativeDest: path });
      }
    }
  }
});
