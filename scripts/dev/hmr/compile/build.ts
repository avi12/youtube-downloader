/**
 * Dev-only HMR build. Compiles the Svelte component trees of the popup and the YouTube content
 * script into re-importable ES modules under <output>/hmr/, plus the manifest the in-page runtime
 * (runtime/runtime.ts) polls. The prod `wxt build` never runs this - the dev server's loaders
 * (output/patches.ts) point the popup and the content script at these modules instead of the
 * prod bundle, so the running code IS the HMR build and a `.svelte` edit swaps in place.
 *
 * vite-plugin-svelte force-disables compilerOptions.hmr in build mode, so components are compiled
 * directly via svelte.compile({ hmr: true }); Vite would replace the `import.meta.hot` token with
 * `undefined` in a build, so the token is rewritten to a context bound to a stable module id.
 *
 * `.svelte` files hot-swap through their own HMR proxy; a `.ts` / `.svelte.ts` module swaps by re-mounting
 * the components above it only when re-running its top level is harmless (analysis/hot-sources.ts),
 * and its `$state` is carried over (preserve-state.ts). Anything else is left to the rebuild and reload.
 */

import { HMR_MANIFEST_FILE, HMR_OUT_SUBDIR, HMR_POPUP_LOADER_FILE, HMR_RUNTIME_FILE, type HmrManifest, sha1, SOURCE_ID_PREFIX } from "#scripts/dev/hmr/config.ts";
import { createGraphCollector, describeHotSources, type OutputChunk } from "#scripts/dev/hmr/analysis/hot-sources.ts";
import { type BuildBrowser, FileExtension, OutputChunkType } from "#scripts/dev/enums.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { toModuleId } from "./svelte-plugins.ts";
import { computeFinalVersions, describeChunks, hashVendorChunks, versionStampImports } from "./versions.ts";
import { collectMainWorldModules, entryInputs, runViteBuild, toChunks } from "./vite-build.ts";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

// Outputs are written over the previous build (the browser holds served files open, so emptying the
// directory intermittently fails on Windows); leftovers of renamed sources are swept afterwards
function sweepStaleOutputs({ outputDirectory, expectedFiles }: { outputDirectory: string; expectedFiles: Set<string> }) {
  for (const entry of readdirSync(outputDirectory, {
    recursive: true,
    withFileTypes: true
  })) {
    const absolutePath = join(entry.parentPath, entry.name);
    const isStale = entry.isFile() && !expectedFiles.has(relative(outputDirectory, absolutePath).replaceAll("\\", "/"));
    if (isStale) {
      rmSync(absolutePath, {
         force: true,
         maxRetries: 0 
      });
    }
  }
}

function describeModules({ chunks, versions, mainWorldModules }: {
  chunks: OutputChunk[];
  versions: Map<string, string>;
  mainWorldModules: Set<string>;
}) {
  const modules: HmrManifest["modules"] = {};
  const entries: HmrManifest["entries"] = {};
  for (const chunk of chunks) {
    if (chunk.type !== OutputChunkType.Chunk) {
      continue;
    }

    if (chunk.isEntry && chunk.name) {
      entries[chunk.name] = `${HMR_OUT_SUBDIR}/${chunk.fileName}`;
    }

    const sourceId = chunk.facadeModuleId ? toModuleId(chunk.facadeModuleId) : "";
    const isHotSwappable = chunk.facadeModuleId?.endsWith(FileExtension.Svelte) && sourceId.startsWith(SOURCE_ID_PREFIX) && !mainWorldModules.has(sourceId);
    if (isHotSwappable) {
      modules[sourceId] = {
        url: `${HMR_OUT_SUBDIR}/${chunk.fileName}`,
        hash: versions.get(chunk.fileName) ?? sha1(chunk.code ?? "")
      };
    }
  }
  return {
    modules,
    entries
  };
}

function writeLoaders({ outputDirectory, entries, runtimeSource }: {
  outputDirectory: string;
  entries: HmrManifest["entries"];
  runtimeSource: string;
}) {
  writeFileSync(join(outputDirectory, HMR_RUNTIME_FILE), runtimeSource);
  const popupEntry = entries.popup;
  if (!popupEntry) {
    return;
  }

  const popupPath = popupEntry.slice(`${HMR_OUT_SUBDIR}/`.length);
  writeFileSync(
    join(outputDirectory, HMR_POPUP_LOADER_FILE), `globalThis.ytdlDevHmrEntry = "popup";
await import("./${HMR_RUNTIME_FILE}");
await import("./${popupPath}");
`
  );
}

const previousSourceHashes = new Map<string, string>();

// Which modules whose edit reloads the page changed since the last build, and why - the one place the
// side-effect rules are reported
function describeReloadLogs(reloadReasons: HmrManifest["reloadReasons"]) {
  const logs: string[] = [];
  const isFirstBuild = previousSourceHashes.size === 0;
  for (const [sourceId, reason] of Object.entries(reloadReasons)) {
    const hash = sha1(readFileSync(join(PROJECT_ROOT, sourceId)));
    const isEditedSinceLastBuild = !isFirstBuild && previousSourceHashes.get(sourceId) !== hash;
    if (isEditedSinceLastBuild) {
      logs.push(`HMR: ${sourceId} reloads - ${reason}`);
    }

    previousSourceHashes.set(sourceId, hash);
  }

  if (isFirstBuild) {
    logs.push(`HMR: ${Object.keys(reloadReasons).length} modules reload the page when edited (the rest hot-swap)`);
  }

  return logs;
}

export async function buildHmrModules({ outputDir, browser, runtimeSource }: {
  outputDir: string;
  browser: BuildBrowser;
  runtimeSource: string;
}) {
  const outputDirectory = join(outputDir, HMR_OUT_SUBDIR);
  mkdirSync(outputDirectory, { recursive: true });
  const graph = createGraphCollector();
  const [built, mainWorldModules] = await Promise.all([
    runViteBuild({
      input: entryInputs(),
      browser,
      outputDirectory,
      graph,
      isWrite: true
    }),
    collectMainWorldModules(browser)
  ]);

  const chunks = toChunks(built);
  const byFileName = describeChunks(chunks);
  const versions = computeFinalVersions(byFileName);
  for (const [fileName, chunk] of byFileName) {
    writeFileSync(
      join(outputDirectory, fileName), versionStampImports({
      code: chunk.code,
      fileName,
      byFileName,
      versions
    })
    );
  }

  const { modules, entries } = describeModules({
    chunks,
    versions,
    mainWorldModules
  });
  const hotSources = describeHotSources({
    chunks,
    graph,
    mainWorldModules,
    entries,
    outputDirectory
  });
  writeLoaders({
    outputDirectory,
    entries,
    runtimeSource
  });
  sweepStaleOutputs({
    outputDirectory,
    expectedFiles: new Set([
      ...chunks.map(chunk => chunk.fileName),
      HMR_MANIFEST_FILE,
      HMR_RUNTIME_FILE,
      HMR_POPUP_LOADER_FILE
    ])
  });
  const manifest: HmrManifest = {
    entries,
    vendorHash: hashVendorChunks({
      byFileName,
      versions
    }),
    modules,
    styles: hotSources.styles,
    reloadReasons: hotSources.reloadReasons,
    sourceModules: [...Object.keys(modules), ...hotSources.swappableScripts, ...hotSources.cssIds]
  };
  writeFileSync(join(outputDirectory, HMR_MANIFEST_FILE), JSON.stringify(manifest));
  return {
    manifest,
    reloadLogs: describeReloadLogs(hotSources.reloadReasons)
  };
}
