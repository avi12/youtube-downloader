import { resolve } from "node:path";
import { defineConfig } from "wxt";

const ffmpegAssetPaths = [
  "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"
];

const FIREFOX_GECKO_ID = "youtube-downloader@avi12.com";
const sharedPermissions: Browser.runtime.ManifestPermission[] = [
  "alarms",
  "downloads",
  "notifications",
  "declarativeNetRequestWithHostAccess",
  "storage",
  "tabs",
  "webRequest"
];

export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  modules: ["@wxt-dev/module-svelte"],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: "YouTube Downloader",
    description: "Download YouTube videos and audio directly from the page",
    permissions: browser === "firefox" ? sharedPermissions : [...sharedPermissions, "offscreen"],
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
    ...browser === "firefox"
      ? {
        browser_specific_settings: {
          gecko: {
            id: FIREFOX_GECKO_ID,
            strict_min_version: "147.0",
            data_collection_permissions: {
              required: ["none"]
            }
          }
        }
      }
      : {
        minimum_chrome_version: "125.0"
      }
  }),
  zip: {
    artifactTemplate: "youtube-downloader-{{version}}-{{browser}}.zip",
    excludeSources: [
      "user-profiles/**",
      ".output/**",
      ".chrome-for-testing/**",
      ".wxt/**",
      ".dev-certs/**",
      ".fallow/**",
      "scripts/**"
    ]
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
