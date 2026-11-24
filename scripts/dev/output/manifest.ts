// The built manifest as the dev server reads it: content scripts per world, background files, match patterns
import { FileExtension } from "#scripts/dev/enums.ts";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const ContentScriptWorld = {
  Isolated: "ISOLATED",
  Main: "MAIN"
} as const;
type ContentScriptWorld = (typeof ContentScriptWorld)[keyof typeof ContentScriptWorld];

interface ManifestContentScript {
  matches?: string[];
  js?: string[];
  css?: string[];
  world?: ContentScriptWorld;
  all_frames?: boolean;
}

export interface ExtensionManifest {
  name?: string;
  background?: {
    service_worker?: string;
    scripts?: string[];
  };
  content_scripts?: ManifestContentScript[];
  browser_specific_settings?: {
    gecko?: { id?: string };
  };
}

export interface ContentScriptEntry {
  // WXT entrypoint names, one per js file - the name WXT's ContentScriptContext keys its events on
  names: string[];
  world: ContentScriptWorld;
  matches: string[];
  js: string[];
  css: string[];
  isAllFrames: boolean;
}

// The wildcards of a manifest match pattern
const MatchPatternToken = {
  AnyHost: "*",
  AnySubdomain: "*.",
  AllUrls: "<all_urls>"
} as const;
const ANY_WEB_SCHEME_SOURCE = "https?";

export const MANIFEST_FILE = "manifest.json";

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

export function listContentScripts(manifest: ExtensionManifest) {
  return (manifest.content_scripts ?? [])
    .map(entry => ({
      ...DEFAULT_CONTENT_SCRIPT,
      ...entry
    }))
    .map(({ js, css, matches, world, all_frames: isAllFrames }) => ({
      names: js.map(file => basename(file, FileExtension.Js)),
      world,
      matches,
      js,
      css,
      isAllFrames
    }));
}

export function isMainWorld(entry: ContentScriptEntry) {
  return entry.world === ContentScriptWorld.Main;
}

export function listBackgroundFiles({ background }: ExtensionManifest) {
  return [background?.service_worker, ...background?.scripts ?? []].filter(file => file !== undefined);
}

// Leaves `*` alone - it is the match-pattern wildcard, turned into a regex wildcard by the caller
function escapeRegexLiteral(text: string) {
  return text.replaceAll(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function hostPatternSource(host: string) {
  if (host === MatchPatternToken.AnyHost) {
    return "[^/]+";
  }

  if (host.startsWith(MatchPatternToken.AnySubdomain)) {
    return `([^/]+\\.)?${escapeRegexLiteral(host.slice(MatchPatternToken.AnySubdomain.length))}`;
  }

  return escapeRegexLiteral(host);
}

// A manifest match pattern as a test on a URL, for picking CDP page targets (the extension's own
// tabs.query matches natively)
export function matchesUrlPattern({ url, pattern }: { url: string; pattern: string }) {
  const match = pattern.match(/^(\*|https?|wss?|file|ftp):\/\/([^/]*)(\/.*)$/);
  if (!match) {
    return pattern === MatchPatternToken.AllUrls;
  }

  const [, scheme, host, path] = match;
  const schemeSource = scheme === MatchPatternToken.AnyHost ? ANY_WEB_SCHEME_SOURCE : escapeRegexLiteral(scheme);
  const pathSource = escapeRegexLiteral(path).replaceAll("*", ".*");
  return new RegExp(`^${schemeSource}://${hostPatternSource(host)}${pathSource}$`).test(url);
}

export function describeContentScripts(entries: ContentScriptEntry[]) {
  return [...new Set(entries.flatMap(entry => entry.names))].join(", ");
}
