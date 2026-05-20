import { resolve } from "node:path";
import { defineConfig } from "wxt";

const ffmpegAssetPaths = [
  "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"
];

export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  modules: ["@wxt-dev/module-svelte"],
  manifestVersion: 3,
  manifest: {
    name: "YouTube Downloader",
    description: "Download YouTube videos and audio directly from the page",
    permissions: [
      "alarms",
      "downloads",
      "notifications",
      "offscreen",
      "storage",
      "tabs",
      "webRequest",
      "declarativeNetRequestWithHostAccess"
    ],
    host_permissions: [
      "https://*.youtube.com/*",
      "https://*.googlevideo.com/*",
      "https://i.ytimg.com/*"
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
    },
    declarative_net_request: {
      rule_resources: [{
        id: "strip-youtube-frame-headers",
        enabled: true,
        path: "rules/strip-youtube-frame-headers.json"
      }]
    },
    web_accessible_resources: [
      {
        resources: ["offscreen.html"],
        matches: ["<all_urls>"]
      }
    ],
    minimum_chrome_version: "117.0"
  },
  hooks: {
    "prepare:publicPaths"(_, paths) {
      paths.push(...ffmpegAssetPaths);
    },
    "build:publicAssets"(_, assets) {
      for (const path of ffmpegAssetPaths) {
        assets.push({
          absoluteSrc: resolve(path),
          relativeDest: path
        });
      }
    }
  }
});
