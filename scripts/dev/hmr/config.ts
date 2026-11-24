/**
 * What the dev-only HMR build and its loaders share: where the output lives, which entrypoints are
 * hot-swappable, and the manifest the in-page runtime polls.
 */

import { createHash } from "node:crypto";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { resolve } from "node:path";

export const HMR_OUT_SUBDIR = "hmr";
export const HMR_MANIFEST_FILE = "manifest.json";
export const HMR_RUNTIME_FILE = "runtime.js";
export const HMR_POPUP_LOADER_FILE = "popup-loader.js";
export const HMR_POLL_INTERVAL_MS = 250;
// The object the in-page runtime installs on globalThis: the hot contexts and the $state registry the
// compiled components call (globals.d.ts declares it for the runtime)
export const HMR_RUNTIME_GLOBAL = "ytdlDevHmr";
export const YOUTUBE_WAR_MATCH = "*://*.youtube.com/*";

export const HmrEntryKind = {
  Page: "page",
  ContentScript: "content-script"
} as const;
type HmrEntryKind = (typeof HmrEntryKind)[keyof typeof HmrEntryKind];

interface HmrEntryDefinition {
  name: string;
  kind: HmrEntryKind;
  sourcePath: string;
  // The built file the loader replaces: the page's HTML or the content script's JS
  builtFile: string;
}

// Only extension code that mounts Svelte components can hot-swap. Background, MAIN-world scripts and
// the offscreen document are not in this list, so an edit to them reloads like it always did
export const HMR_ENTRIES: HmrEntryDefinition[] = [
  {
    name: "popup",
    kind: HmrEntryKind.Page,
    sourcePath: "src/layers/popup/entrypoints/popup/main.ts",
    builtFile: "popup.html"
  },
  {
    name: "youtube",
    kind: HmrEntryKind.ContentScript,
    sourcePath: "src/layers/youtube/entrypoints/youtube.content/index.ts",
    builtFile: "content-scripts/youtube.js"
  }
];

export interface HmrManifest {
  entries: Record<string, string>;
  vendorHash: string;
  modules: Record<string, {
     url: string;
     hash: string 
  }>;
  // Per entrypoint: the global stylesheets its runtime re-applies in place
  styles: Record<string, {
     urls: string[];
     hash: string 
  }>;
  // Module id -> why editing it reloads the page, for modules the build analysed and rejected
  reloadReasons: Record<string, string>;
  sourceModules: string[];
}

const SRC_DIR = resolve(PROJECT_ROOT, "src");
export const SOURCE_ID_PREFIX = "src/";
export const SRC_PREFIX = `${SRC_DIR.replaceAll("\\", "/")}/`;
const SHORT_HASH_LENGTH = 12;

export function sha1(content: string | Buffer) {
  return createHash("sha1").update(content).digest("hex").slice(0, SHORT_HASH_LENGTH);
}

// The project-relative `src/...` id of a module path, or undefined for anything outside src/
export function srcIdOf(modulePath: string) {
  const filePath = modulePath.split("?")[0].replaceAll("\\", "/");
  return filePath.startsWith(SRC_PREFIX) ? `${SOURCE_ID_PREFIX}${filePath.slice(SRC_PREFIX.length)}` : undefined;
}
