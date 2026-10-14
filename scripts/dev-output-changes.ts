/**
 * Diffs two WXT builds by content hash and turns the changed output files into the smallest
 * update that makes them live in the running browser. WXT rewrites every output file on every
 * build, so mtimes say nothing; content hashes do, and Rolldown's hashed chunk names make a
 * change bubble up into the HTML page that loads it.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  basename,
  extname,
  join,
  relative
} from "node:path";

export const ContentScriptWorld = {
  Isolated: "ISOLATED",
  Main: "MAIN"
} as const;
type ContentScriptWorld = (typeof ContentScriptWorld)[keyof typeof ContentScriptWorld];

type ManifestContentScript = {
  matches?: string[];
  js?: string[];
  css?: string[];
  world?: ContentScriptWorld;
  all_frames?: boolean;
};

export type ExtensionManifest = {
  name?: string;
  background?: {
    service_worker?: string;
    scripts?: string[];
  };
  content_scripts?: ManifestContentScript[];
  browser_specific_settings?: {
    gecko?: { id?: string };
  };
};

export type ContentScriptEntry = {
  // WXT entrypoint names, one per js file - the name WXT's ContentScriptContext keys its events on
  names: string[];
  world: ContentScriptWorld;
  matches: string[];
  js: string[];
  css: string[];
  isAllFrames: boolean;
};

const MANIFEST_FILE = "manifest.json";
const LOCALES_DIR_PREFIX = "_locales/";
const HTML_EXTENSION = ".html";
// Chrome writes its indexed DNR rulesets into the unpacked extension's own dir
const BROWSER_METADATA_DIR_PREFIX = "_metadata/";
// Manifest-named files the browser re-reads on its own: pages on every open, scripts and styles
// through a reload or re-injection planned for them separately
const LIVE_LOADED_EXTENSIONS = new Set([HTML_EXTENSION, ".js", ".css"]);
const EMPTY_MANIFEST: ExtensionManifest = {};
const DEFAULT_CONTENT_SCRIPT: Required<ManifestContentScript> = {
  matches: [],
  js: [],
  css: [],
  world: ContentScriptWorld.Isolated,
  all_frames: false
};

export function readBuiltManifest(outputDir: string) {
  const manifest: ExtensionManifest = JSON.parse(readFileSync(join(outputDir, MANIFEST_FILE), "utf-8"));
  return manifest;
}

// Firefox's runtime.id and RDP's addon id
export function readGeckoId(manifest: ExtensionManifest) {
  return manifest.browser_specific_settings?.gecko?.id ?? "";
}

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
    .filter(file => !file.startsWith(BROWSER_METADATA_DIR_PREFIX));
}

export function takeBuildSnapshot(outputDir: string) {
  const files = listOutputFiles(outputDir);
  return {
    fileHashes: new Map(files.map(file => [file, createHash("sha1").update(readFileSync(join(outputDir, file))).digest("hex")])),
    manifest: files.includes(MANIFEST_FILE) ? readBuiltManifest(outputDir) : EMPTY_MANIFEST
  };
}

type BuildSnapshot = ReturnType<typeof takeBuildSnapshot>;

export function listContentScripts(manifest: ExtensionManifest) {
  return (manifest.content_scripts ?? [])
    .map(entry => ({
      ...DEFAULT_CONTENT_SCRIPT,
      ...entry
    }))
    .map(({ js, css, matches, world, all_frames: isAllFrames }): ContentScriptEntry => ({
      names: js.map(file => basename(file, ".js")),
      world,
      matches,
      js,
      css,
      isAllFrames
    }));
}

function isMainWorld(entry: ContentScriptEntry) {
  return entry.world === ContentScriptWorld.Main;
}

function listBackgroundFiles({ background }: ExtensionManifest) {
  return [background?.service_worker, ...background?.scripts ?? []].filter(file => file !== undefined);
}

// Leaves `*` alone - it is the match-pattern wildcard, turned into a regex wildcard by the caller
function escapeRegexLiteral(text: string) {
  return text.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function hostPatternSource(host: string) {
  if (host === "*") {
    return "[^/]+";
  }

  if (host.startsWith("*.")) {
    return `([^/]+\\.)?${escapeRegexLiteral(host.slice(2))}`;
  }

  return escapeRegexLiteral(host);
}

// A manifest match pattern as a test on a URL, for picking CDP page targets (the extension's own
// tabs.query matches natively)
export function matchesUrlPattern(url: string, pattern: string) {
  const match = pattern.match(/^(\*|https?|wss?|file|ftp):\/\/([^/]*)(\/.*)$/);
  if (!match) {
    return pattern === "<all_urls>";
  }

  const [, scheme, host, path] = match;
  const schemeSource = scheme === "*" ? "https?" : escapeRegexLiteral(scheme);
  const pathSource = escapeRegexLiteral(path).replaceAll("*", ".*");
  return new RegExp(`^${schemeSource}://${hostPatternSource(host)}${pathSource}$`).test(url);
}

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
  if (file === MANIFEST_FILE || file.startsWith(LOCALES_DIR_PREFIX)) {
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

export function describeContentScripts(entries: ContentScriptEntry[]) {
  return [...new Set(entries.flatMap(entry => entry.names))].join(", ");
}

export const ReloadKind = {
  None: "none",
  RefreshPages: "refresh-pages",
  ReloadExtension: "reload-extension"
} as const;

export type ReloadPlan =
  | { kind: typeof ReloadKind.None }
  | {
    kind: typeof ReloadKind.RefreshPages;
    // HTML entrypoints whose page changed (popup, offscreen, download-worker)
    pageNames: string[];
    // Changed files no single page owns (an unlisted script like mux-worker.js, a public asset) -
    // any open page may load them
    sharedAssetFiles: string[];
  }
  | {
    kind: typeof ReloadKind.ReloadExtension;
    reasons: string[];
    // MAIN-world scripts that changed - their tabs are reloaded, a page-world script can't be swapped
    mainWorldContentScripts: ContentScriptEntry[];
    // Every ISOLATED script - the extension reload orphans them all, so all are re-injected in place
    isolatedContentScripts: ContentScriptEntry[];
    changedIsolatedStyleSheets: string[];
  };

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
  const reasons = [
    {
      isChanged: listBackgroundFiles(after.manifest).some(file => changedFiles.has(file)),
      reason: "background changed"
    },
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
  if (!reasons.length) {
    return undefined;
  }

  return {
    kind: ReloadKind.ReloadExtension,
    reasons,
    mainWorldContentScripts,
    isolatedContentScripts: listContentScripts(after.manifest).filter(entry => !isMainWorld(entry)),
    changedIsolatedStyleSheets: changedIsolatedContentScripts.flatMap(entry => entry.css).filter(file => changedFiles.has(file))
  };
}

function planPageRefresh({ after, changedFiles }: {
  after: BuildSnapshot;
  changedFiles: Set<string>;
}) {
  const files = [...changedFiles];
  return {
    kind: ReloadKind.RefreshPages,
    pageNames: files
      .filter(file => file.endsWith(HTML_EXTENSION) && after.fileHashes.has(file))
      .map(file => basename(file, HTML_EXTENSION)),
    sharedAssetFiles: files.filter(file => !file.endsWith(HTML_EXTENSION) && !isHashedPageAsset(file))
  };
}

export function planReload({ before, after }: {
  before: BuildSnapshot;
  after: BuildSnapshot;
}): ReloadPlan {
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
