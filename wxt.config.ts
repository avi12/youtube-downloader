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
  manifest: ({ mode }) => ({
    name: "YouTube Downloader",
    description: "Download YouTube videos and audio directly from the page",
    permissions: [
      "alarms",
      "cookies",
      "downloads",
      "offscreen",
      "storage",
      "unlimitedStorage",
      "tabs",
      "webRequest",
      "webRequestBody",
      "declarativeNetRequest",
      "declarativeNetRequestWithHostAccess"
    ],
    host_permissions: [
      "https://*.youtube.com/*",
      "https://*.googlevideo.com/*",
      "https://*.googleapis.com/*",
      "https://i.ytimg.com/*",
      ...(mode === "development" ? ["http://localhost/*", "https://localhost/*"] : [])
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
    ]
  }),
  vite: () => ({
    server: {
      strictPort: false,
      watch: {
        usePolling: true,
        interval: 500
      }
    },
    build: { sourcemap: true }
  }),
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
