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
      "downloads",
      "storage",
      "tabs",
      "cookies",
      "webRequest",
      ...(browser === "chrome" ? ["offscreen"] : [])
    ],
    host_permissions: [
      "https://www.youtube.com/*",
      "https://*.googlevideo.com/*"
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    web_accessible_resources: [
      {
        resources: [
          ...(browser === "chrome" ? ["offscreen.html"] : []),
          "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
          "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
          "node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js",
          "node_modules/@ffmpeg/ffmpeg/dist/esm/const.js",
          "node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js"
        ],
        matches: ["<all_urls>"]
      }
    ]
  }),
  hooks: {
    "prepare:publicPaths"(_, paths) {
      const ffmpegPaths = [
        "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
        "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
        "node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js",
        "node_modules/@ffmpeg/ffmpeg/dist/esm/const.js",
        "node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js"
      ];

      paths.push(...ffmpegPaths);
    },
    "build:publicAssets"(_, assets) {
      const ffmpegAssets = [
        "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
        "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
        "node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js",
        "node_modules/@ffmpeg/ffmpeg/dist/esm/const.js",
        "node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js"
      ];

      for (const path of ffmpegAssets) {
        assets.push({ absoluteSrc: resolve(path), relativeDest: path });
      }
    }
  }
});
