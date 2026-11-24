/**
 * Diffs two WXT builds by content hash and turns the changed output files into the smallest
 * update that makes them live in the running browser. WXT rewrites every output file on every
 * build, so mtimes say nothing; content hashes do, and Rolldown's hashed chunk names make a
 * change bubble up into the HTML page that loads it.
 */

import { FileExtension } from "#scripts/dev/enums.ts";
import { HMR_OUT_SUBDIR } from "#scripts/dev/hmr/config.ts";
import {
  type ContentScriptEntry,
  describeContentScripts,
  type ExtensionManifest,
  isMainWorld,
  listBackgroundFiles,
  listContentScripts,
  MANIFEST_FILE,
  readBuiltManifest
} from "./manifest.ts";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  basename,
  extname,
  join,
  relative
} from "node:path";

const LOCALES_DIR_PREFIX = "_locales/";
// Chrome writes its indexed DNR rulesets into the unpacked extension's own dir
const BROWSER_METADATA_DIR_PREFIX = "_metadata/";
// Manifest-named files the browser re-reads on its own: pages on every open, scripts and styles
// through a reload or re-injection planned for them separately
const LIVE_LOADED_EXTENSIONS = new Set<string>([FileExtension.Html, FileExtension.Js, FileExtension.Css]);
const EMPTY_MANIFEST: ExtensionManifest = {};
const BACKGROUND_CHANGED_REASON = "background changed";
const STALE_BACKGROUND_REASON = "the browser started the background from a script it cached before this build";

function listOutputFiles(outputDir: string) {
  if (!existsSync(outputDir)) {
    return [];
  }

  return readdirSync(outputDir, {
    recursive: true,
    withFileTypes: true
  })
    .filter(entry => entry.isFile())
    .map(entry => relative(outputDir, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .filter(file => !file.startsWith(BROWSER_METADATA_DIR_PREFIX) && !file.startsWith(`${HMR_OUT_SUBDIR}/`));
}

export function takeBuildSnapshot(outputDir: string) {
  const files = listOutputFiles(outputDir);
  return {
    fileHashes: new Map(files.map(file => [file, createHash("sha1").update(readFileSync(join(outputDir, file))).digest("hex")])),
    manifest: files.includes(MANIFEST_FILE) ? readBuiltManifest(outputDir) : EMPTY_MANIFEST
  };
}

type BuildSnapshot = ReturnType<typeof takeBuildSnapshot>;

function collectStrings(value: unknown) {
  const strings: string[] = [];
  JSON.stringify(value, (_key, nested) => {
    if (typeof nested === "string") {
      strings.push(nested);
    }

    return nested;
  });
  return strings;
}

// Read only when the extension loads: the manifest, the files it names directly (icons, static DNR
// rules) and the locale catalogs
function isLoadTimeFile({ file, manifestStrings }: {
  file: string;
  manifestStrings: Set<string>;
}) {
  const isStaticFile = file === MANIFEST_FILE || file.startsWith(LOCALES_DIR_PREFIX);
  if (isStaticFile) {
    return true;
  }

  return manifestStrings.has(file) && !LIVE_LOADED_EXTENSIONS.has(extname(file));
}

function diffFileHashes({ before, after }: {
  before: Map<string, string>;
  after: Map<string, string>;
}) {
  const changedFiles = new Set<string>();
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(file) !== after.get(file)) {
      changedFiles.add(file);
    }
  }
  return changedFiles;
}

export const ReloadKind = {
  None: "none",
  RefreshPages: "refresh-pages",
  SwapBackground: "swap-background",
  ReloadExtension: "reload-extension"
} as const;

interface PageRefreshPlan {
  kind: typeof ReloadKind.RefreshPages;
  // HTML entrypoints whose page changed (popup, offscreen, download-worker)
  pageNames: string[];
  // Changed files no single page owns (an unlisted script like mux-worker.js, a public asset) -
  // any open page may load them
  sharedAssetFiles: string[];
}

interface ExtensionReloadPlan {
    kind: typeof ReloadKind.ReloadExtension;
    reasons: string[];
    // MAIN-world scripts that changed - their tabs are reloaded, a page-world script can't be swapped
    mainWorldContentScripts: ContentScriptEntry[];
    // Every ISOLATED script - the extension reload orphans them all, so all are re-injected in place
    isolatedContentScripts: ContentScriptEntry[];
    changedIsolatedStyleSheets: string[];
}

// Only the background changed: it restarts in place inside the running extension (browsers/background-swap.ts),
// so the content scripts in open tabs are never orphaned. The fallback is what runs if that fails.
interface BackgroundSwapPlan {
  kind: typeof ReloadKind.SwapBackground;
  backgroundFiles: string[];
  pageRefresh: PageRefreshPlan | undefined;
  fallback: ExtensionReloadPlan;
}

export type ReloadPlan = { kind: typeof ReloadKind.None } | PageRefreshPlan | BackgroundSwapPlan | ExtensionReloadPlan;

// A changed manifest content_scripts list counts every script on either side as changed
function listChangedContentScripts({ before, after, changedFiles }: {
  before: BuildSnapshot;
  after: BuildSnapshot;
  changedFiles: Set<string>;
}) {
  const contentScriptsAfter = listContentScripts(after.manifest);
  const isContentScriptSetChanged =
    JSON.stringify(before.manifest.content_scripts) !== JSON.stringify(after.manifest.content_scripts);
  if (isContentScriptSetChanged) {
    return [...listContentScripts(before.manifest), ...contentScriptsAfter];
  }

  return contentScriptsAfter.filter(entry => [...entry.js, ...entry.css].some(file => changedFiles.has(file)));
}

function planExtensionReload({ before, after, changedFiles }: {
  before: BuildSnapshot;
  after: BuildSnapshot;
  changedFiles: Set<string>;
}) {
  const changedContentScripts = listChangedContentScripts({
    before,
    after,
    changedFiles
  });
  const mainWorldContentScripts = changedContentScripts.filter(isMainWorld);
  const changedIsolatedContentScripts = changedContentScripts.filter(entry => !isMainWorld(entry));
  const manifestStrings = new Set(collectStrings(after.manifest).map(text => text.replace(/^\//, "")));
  const loadTimeFiles = [...changedFiles].filter(file => isLoadTimeFile({
    file,
    manifestStrings
  }));
  const backgroundFiles = listBackgroundFiles(after.manifest);
  const isBackgroundChanged = backgroundFiles.some(file => changedFiles.has(file));
  const otherReasons = [
    {
      isChanged: loadTimeFiles.length > 0,
      reason: `${loadTimeFiles.join(", ")} changed`
    },
    {
      isChanged: changedIsolatedContentScripts.length > 0,
      reason: `content script ${describeContentScripts(changedIsolatedContentScripts)} changed`
    },
    {
      isChanged: mainWorldContentScripts.length > 0,
      reason: `MAIN-world content script ${describeContentScripts(mainWorldContentScripts)} changed`
    }
  ].filter(({ isChanged }) => isChanged).map(({ reason }) => reason);
  const reasons = isBackgroundChanged ? [BACKGROUND_CHANGED_REASON, ...otherReasons] : otherReasons;
  if (!reasons.length) {
    return undefined;
  }

  const extensionReload: ExtensionReloadPlan = {
    kind: ReloadKind.ReloadExtension,
    reasons,
    mainWorldContentScripts,
    isolatedContentScripts: listContentScripts(after.manifest).filter(entry => !isMainWorld(entry)),
    changedIsolatedStyleSheets: changedIsolatedContentScripts.flatMap(entry => entry.css).filter(file => changedFiles.has(file))
  };
  if (otherReasons.length) {
    return extensionReload;
  }

  const pageRefresh = planPageRefresh({
    after,
    changedFiles: new Set([...changedFiles].filter(file => !backgroundFiles.includes(file)))
  });
  const isPageRefreshNeeded = pageRefresh.pageNames.length > 0 || pageRefresh.sharedAssetFiles.length > 0;
  return {
    kind: ReloadKind.SwapBackground,
    backgroundFiles,
    pageRefresh: isPageRefreshNeeded ? pageRefresh : undefined,
    fallback: extensionReload
  } satisfies BackgroundSwapPlan;
}

function planPageRefresh({ after, changedFiles }: {
  after: BuildSnapshot;
  changedFiles: Set<string>;
}) {
  const files = [...changedFiles];
  const plan: PageRefreshPlan = {
    kind: ReloadKind.RefreshPages,
    pageNames: files
      .filter(file => file.endsWith(FileExtension.Html) && after.fileHashes.has(file))
      .map(file => basename(file, FileExtension.Html)),
    sharedAssetFiles: files.filter(file => !file.endsWith(FileExtension.Html) && !isHashedPageAsset(file))
  };
  return plan;
}

export function planReload({ before, after }: {
  before: BuildSnapshot;
  after: BuildSnapshot;
}) {
  const changedFiles = diffFileHashes({
    before: before.fileHashes,
    after: after.fileHashes
  });
  if (!changedFiles.size) {
    return { kind: ReloadKind.None };
  }

  return planExtensionReload({
    before,
    after,
    changedFiles
  }) ?? planPageRefresh({
    after,
    changedFiles
  });
}

// Vite's content-hashed page chunks/styles: a change to one already shows up as a changed page
function isHashedPageAsset(file: string) {
  return /^(chunks|assets)\/.+-[\w-]{8}\.(js|css)$/.test(file);
}

// Chrome runs an unpacked extension's service worker from the script it cached at install, even
// across browser launches, so a profile reused from an older session can start with stale code
export function planStaleBackgroundReload(manifest: ExtensionManifest) {
  const plan: ExtensionReloadPlan = {
    kind: ReloadKind.ReloadExtension,
    reasons: [STALE_BACKGROUND_REASON],
    mainWorldContentScripts: [],
    isolatedContentScripts: listContentScripts(manifest).filter(entry => !isMainWorld(entry)),
    changedIsolatedStyleSheets: []
  };
  return plan;
}
