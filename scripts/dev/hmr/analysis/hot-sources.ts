/**
 * Works out, from the HMR build's module graph, which source files an edit can hot-swap:
 *  - `.svelte` files: the component swaps itself through its HMR proxy
 *  - `.ts` / `.svelte.ts` modules: re-imported, which re-mounts the nearest `.svelte` components
 *    importing them (their version changes with it, see computeFinalVersions in compile/versions.ts). Allowed
 *    only when the module and every module between it and those components is free of top-level side
 *    effects (side-effects.ts) and none of them is an entrypoint - the way Vite's accept
 *    boundaries work: an update that reaches a module nobody accepts means a reload
 *  - global `.css` files: the entrypoint's runtime swaps the stylesheet in place
 */

import { HMR_ENTRIES, HMR_OUT_SUBDIR, type HmrManifest, sha1, srcIdOf } from "#scripts/dev/hmr/config.ts";
import { FileExtension, OutputChunkType } from "#scripts/dev/enums.ts";
import { findSideEffect } from "./side-effects.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OutputChunk {
  type: string;
  name?: string;
  fileName: string;
  isEntry?: boolean;
  facadeModuleId?: string | null;
  code?: string;
  moduleIds?: string[];
  imports?: string[];
  dynamicImports?: string[];
}

export interface GraphCollector {
  files: Set<string>;
  // css source id -> the source ids of the modules importing it
  cssImporters: Map<string, string[]>;
  // css imported with a query (`?inline`): its text is consumed as a string, not applied globally
  queriedCss: Set<string>;
}

export function createGraphCollector() {
  return {
    files: new Set(),
    cssImporters: new Map(),
    queriedCss: new Set()
  } satisfies GraphCollector;
}

const SCRIPT_MODULE = /\.(?:ts|js)$/;

interface ChunkInfo {
  fileName: string;
  sourceId?: string;
  absolutePath?: string;
  entryName?: string;
  isSvelte: boolean;
}

function describeChunkInfo(chunk: OutputChunk) {
  const absolutePath = chunk.facadeModuleId?.split("?")[0];
  return {
    fileName: chunk.fileName,
    sourceId: chunk.facadeModuleId ? srcIdOf(chunk.facadeModuleId) : undefined,
    absolutePath,
    entryName: chunk.isEntry ? chunk.name : undefined,
    isSvelte: absolutePath?.endsWith(FileExtension.Svelte) ?? false
  } satisfies ChunkInfo;
}

function mapImporters(chunks: OutputChunk[]) {
  const importers = new Map<string, string[]>();
  for (const chunk of chunks) {
    for (const dependency of [...chunk.imports ?? [], ...chunk.dynamicImports ?? []]) {
      importers.set(dependency, [...importers.get(dependency) ?? [], chunk.fileName]);
    }
  }
  return importers;
}

function sideEffectReason(info: ChunkInfo) {
  if (!info.absolutePath) {
    return undefined;
  }

  try {
    const found = findSideEffect({
      source: readFileSync(info.absolutePath, "utf-8"),
      filename: info.absolutePath
    });
    return found && `${found.rule} at line ${found.line}`;
  } catch (error) {
    return `could not be analysed (${String(error).split("\n")[0]})`;
  }
}

// Why editing this chunk can't be swapped, or undefined when it can: walks up the importers until a
// `.svelte` component (the accept boundary) and reports the first module that stops the update
function createReloadReasoner(chunks: OutputChunk[]) {
  const infoByFileName = new Map(chunks.filter(chunk => chunk.type === OutputChunkType.Chunk).map(chunk => [chunk.fileName, describeChunkInfo(chunk)]));
  const importers = mapImporters(chunks);

  function ownReason(info: ChunkInfo) {
    if (info.entryName) {
      return `it is the ${info.entryName} entrypoint, outside any component`;
    }

    const hasNoImporter = !importers.get(info.fileName)?.length;
    return sideEffectReason(info) ?? (hasNoImporter ? "no component imports it" : undefined);
  }

  function reasonOf(fileName: string) {
    const visited = new Set<string>();
    const pending = [fileName];
    for (const current of pending) {
      const info = infoByFileName.get(current);
      const isBoundaryOrSeen = !info || info.isSvelte || visited.has(current);
      if (isBoundaryOrSeen) {
        continue;
      }

      visited.add(current);
      const reason = ownReason(info);
      if (reason) {
        return current === fileName ? reason : `${reason} (via ${info.sourceId ?? current})`;
      }

      pending.push(...importers.get(current) ?? []);
    }
    return undefined;
  }

  return {
    infoByFileName,
    reasonOf
  };
}

function reachableFrom({ chunks, fileName }: { chunks: OutputChunk[]; fileName: string }) {
  const byFileName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const reached = new Set<string>();
  const pending = [fileName];
  for (const current of pending) {
    if (reached.has(current)) {
      continue;
    }

    reached.add(current);
    const chunk = byFileName.get(current);
    pending.push(...chunk?.imports ?? [], ...chunk?.dynamicImports ?? []);
  }
  return reached;
}

function describeStyles({ chunks, graph, mainWorldModules, entries, outputDirectory }: {
  chunks: OutputChunk[];
  graph: GraphCollector;
  mainWorldModules: Set<string>;
  entries: HmrManifest["entries"];
  outputDirectory: string;
}) {
  const chunkBySourceId = new Map(chunks.flatMap(chunk => {
    const sourceId = chunk.facadeModuleId && srcIdOf(chunk.facadeModuleId);
    return sourceId ? [[sourceId, chunk.fileName] as const] : [];
  }));
  const assetFiles = new Set(chunks.filter(chunk => chunk.type === OutputChunkType.Asset).map(chunk => chunk.fileName));
  const styles: HmrManifest["styles"] = {};
  const cssIds = new Set<string>();
  for (const { name } of HMR_ENTRIES) {
    const entryFile = entries[name]?.slice(`${HMR_OUT_SUBDIR}/`.length);
    const reached = entryFile ? reachableFrom({
      chunks,
      fileName: entryFile
    }) : new Set<string>();
    const ownCss = [...graph.cssImporters]
      .filter(([cssId]) => !graph.queriedCss.has(cssId) && !mainWorldModules.has(cssId) && assetFiles.has(`assets/${cssId}`))
      .filter(([, importerIds]) => importerIds.some(importerId => reached.has(chunkBySourceId.get(importerId) ?? "")))
      .map(([cssId]) => cssId)
      .toSorted();
    for (const cssId of ownCss) {
      cssIds.add(cssId);
    }

    styles[name] = {
      urls: ownCss.map(cssId => `${HMR_OUT_SUBDIR}/assets/${cssId}`),
      hash: sha1(Buffer.concat(ownCss.map(cssId => readFileSync(join(outputDirectory, "assets", cssId)))))
    };
  }
  return {
    styles,
    cssIds
  };
}

export function describeHotSources({ chunks, graph, mainWorldModules, entries, outputDirectory }: {
  chunks: OutputChunk[];
  graph: GraphCollector;
  mainWorldModules: Set<string>;
  entries: HmrManifest["entries"];
  outputDirectory: string;
}) {
  const { infoByFileName, reasonOf } = createReloadReasoner(chunks);
  const swappableScripts: string[] = [];
  const reloadReasons: HmrManifest["reloadReasons"] = {};
  for (const info of infoByFileName.values()) {
    const isScript = Boolean(info.sourceId) && SCRIPT_MODULE.test(info.absolutePath ?? "") && !info.entryName;
    if (!isScript || !info.sourceId) {
      continue;
    }

    const reason = mainWorldModules.has(info.sourceId) ? "the MAIN-world script also runs it" : reasonOf(info.fileName);
    if (reason) {
      reloadReasons[info.sourceId] = reason;
      continue;
    }

    swappableScripts.push(info.sourceId);
  }

  const { styles, cssIds } = describeStyles({
    chunks,
    graph,
    mainWorldModules,
    entries,
    outputDirectory
  });
  return {
    swappableScripts,
    reloadReasons,
    styles,
    cssIds: [...cssIds]
  };
}
