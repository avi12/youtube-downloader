import { resolve } from "node:path";
import { defineConfig } from "wxt";

const ffmpegAssets = [
  {
    src: "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm",
    dest: "ffmpeg/ffmpeg-core.wasm"
  }
];

const FIREFOX_GECKO_ID = "youtube-downloader@avi12.com";
const UPDATE_URL_BASE = "https://avi12.github.io/youtube-downloader";
const FIREFOX_UPDATE_URL = `${UPDATE_URL_BASE}/updates.json`;
const { CSP_REPORT_URI = "" } = process.env;
const EXTENSION_PAGES_CSP = `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'${CSP_REPORT_URI ? `; report-uri ${CSP_REPORT_URI}` : ""}`;
const sharedPermissions: Browser.runtime.ManifestPermission[] = [
  "alarms",
  "downloads",
  "unlimitedStorage",
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
      "https://*.googlevideo.com/*"
    ],
    content_security_policy: {
      extension_pages: EXTENSION_PAGES_CSP
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
            update_url: FIREFOX_UPDATE_URL,
            data_collection_permissions: {
              required: ["none"],
              optional: ["technicalAndInteraction"]
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
      paths.push(...ffmpegAssets.map(asset => asset.dest));
    },
    "build:publicAssets"(_, assets) {
      for (const { src, dest } of ffmpegAssets) {
        assets.push({
          absoluteSrc: resolve(src),
          relativeDest: dest
        });
      }
    }
  }
});
