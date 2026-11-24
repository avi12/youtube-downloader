// Per-module versions: a change bubbles through plain dependencies up to the nearest component, and
// version-stamped imports make a re-import fetch exactly what changed
import { sha1, SRC_PREFIX } from "#scripts/dev/hmr/config.ts";
import type { OutputChunk } from "#scripts/dev/hmr/analysis/hot-sources.ts";
import { FileExtension, OutputChunkType } from "#scripts/dev/enums.ts";
import { createHash } from "node:crypto";
import { posix } from "node:path";

const SHORT_HASH_LENGTH = 12;
const RELATIVE_IMPORT_PATTERN = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.\.?\/[^"']+?)\2/g;

export interface HmrChunk {
  code: string;
  srcHash: string;
  isSvelte: boolean;
  isVendor: boolean;
  deps: string[];
}

// A dependency chunk's hash covers its module PATHS only: node_modules never changes in a session
function vendorChunkHash({ moduleIds, fallbackCode }: { moduleIds: string[]; fallbackCode: string }) {
  const paths = moduleIds.map(id => String(id).split("?")[0].replaceAll("\\", "/")).toSorted();
  return sha1(paths.length ? paths.join("|") : fallbackCode);
}

// Each module's hash propagates through its NON-`.svelte` dependencies and stops at every `.svelte`
// one: a component swaps itself through its HMR proxy, so a change inside it never bubbles upward
export function computeFinalVersions(byFileName: Map<string, HmrChunk>) {
  const versions = new Map<string, string>();
  const visiting = new Set<string>();

  function versionOf(fileName: string) {
    const cached = versions.get(fileName);
    if (cached !== undefined) {
      return cached;
    }

    const chunk = byFileName.get(fileName);
    if (!chunk) {
      return "0";
    }

    if (visiting.has(fileName)) {
      return chunk.srcHash;
    }

    visiting.add(fileName);
    const parts = [chunk.srcHash];
    for (const dep of chunk.deps) {
      if (byFileName.get(dep)?.isSvelte) {
        continue;
      }

      parts.push(versionOf(dep));
    }
    visiting.delete(fileName);
    const version = sha1(parts.join("|"));
    versions.set(fileName, version);
    return version;
  }

  for (const fileName of byFileName.keys()) {
    versionOf(fileName);
  }
  return versions;
}

// `?v=<version>` on each non-`.svelte` relative import, so a re-imported boundary refetches exactly the
// dependencies whose content changed and reuses the cached rest (the Svelte runtime singleton)
export function versionStampImports({ code, fileName, byFileName, versions }: {
  code: string;
  fileName: string;
  byFileName: Map<string, HmrChunk>;
  versions: Map<string, string>;
}) {
  const fromDirectory = posix.dirname(fileName);
  return code.replaceAll(RELATIVE_IMPORT_PATTERN, (match: string, prefix: string, quote: string, specifier: string) => {
    const target = posix.normalize(posix.join(fromDirectory, specifier));
    const dependency = byFileName.get(target);
    if (!dependency || dependency.isSvelte) {
      return match;
    }

    return `${prefix}${quote}${specifier}?v=${versions.get(target)}${quote}`;
  });
}

export function describeChunks(chunks: OutputChunk[]) {
  const byFileName = new Map<string, HmrChunk>();
  for (const chunk of chunks) {
    if (chunk.type !== OutputChunkType.Chunk) {
      continue;
    }

    const isVendor = (chunk.moduleIds ?? []).every(id => !String(id).split("?")[0].replaceAll("\\", "/").startsWith(SRC_PREFIX));
    byFileName.set(chunk.fileName, {
      code: chunk.code ?? "",
      srcHash: isVendor ? vendorChunkHash({
        moduleIds: chunk.moduleIds ?? [],
        fallbackCode: chunk.code ?? ""
      }) : sha1(chunk.code ?? ""),
      isSvelte: chunk.facadeModuleId?.endsWith(FileExtension.Svelte) ?? false,
      isVendor,
      deps: [...chunk.imports ?? [], ...chunk.dynamicImports ?? []]
    });
  }
  return byFileName;
}

// Dependency chunks (the Svelte runtime, vendor code) are cached singletons every swap resolves
// against; when the bundler re-splits the graph, the runtime reloads the page instead of swapping
export function hashVendorChunks({ byFileName, versions }: {
  byFileName: Map<string, HmrChunk>;
  versions: Map<string, string>;
}) {
  const hash = createHash("sha1");
  const entries = [...byFileName].filter(([, chunk]) => chunk.isVendor).map(([fileName]) => `${fileName}:${versions.get(fileName)}`);
  for (const entry of entries.toSorted()) {
    hash.update(`${entry}\0`);
  }
  return hash.digest("hex").slice(0, SHORT_HASH_LENGTH);
}
