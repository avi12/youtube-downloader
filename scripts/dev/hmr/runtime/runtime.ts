/**
 * The in-page half of the dev HMR (compile/build.ts builds what it swaps in). Loaded as an ES module by the
 * dev loaders (output/patches.ts) in the popup page and in every YouTube frame the content script
 * runs in, on Chrome and Firefox alike - it only needs `fetch` and dynamic `import` of the extension's
 * own files.
 *
 *  - installs globalThis.ytdlDevHmr.createHotContext, which the HMR-compiled `.svelte` modules call as
 *    their `import.meta.hot`; Svelte registers one accept callback per component there
 *  - polls the HMR manifest the dev server rewrites after every HMR build (a fetch of an extension
 *    file works in both browsers; Chrome 147+ blocks a public page's connection to loopback, so no
 *    socket is used) and re-imports every component whose hash moved, then runs its accept callback
 *  - when the swap can't be applied (the dependency graph was re-split, a re-import failed, a callback
 *    threw) it reloads the page, which loads the freshly built modules
 *
 *  - keeps component and module `$state` across a swap (the registry under `state`)
 *
 * HMR_CONFIG is prepended by loader.ts from config.ts.
 */

interface HmrConfig {
  manifestPath: string;
  pollIntervalMs: number;
}

interface HmrManifestShape {
  vendorHash: string;
  styles: Record<string, {
     urls: string[];
     hash: string 
  }>;
  modules: Record<string, {
     url: string;
     hash: string 
  }>;
}

declare const HMR_CONFIG: HmrConfig;

type AcceptCallback = (module: unknown) => void;

function getExtensionApi() {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api) {
    throw new Error("[YTDL HMR] no extension API in this context");
  }

  return api;
}

const extensionApi = getExtensionApi();

const acceptCallbacks = new Map<string, AcceptCallback>();

function noop() {}

function createHotContext(moduleId: string) {
  return {
    accept(callback: AcceptCallback) {
      acceptCallbacks.set(moduleId, callback);
    },
    acceptExports(_exports: unknown, callback?: AcceptCallback) {
      if (callback) {
        acceptCallbacks.set(moduleId, callback);
      }
    },
    dispose: noop,
    prune: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
    data: {}
  };
}

// The $state registry the build-time rewrites (compile/preserve-state.ts, ported from youtube-time-manager)
// call: a recreated component re-reads its primitives, a re-imported module adopts its first store
const savedValues = new Map<string, unknown>();
const moduleStates = new Map<string, unknown>();
const liveInstanceCounts = new Map<string, number>();
let isHotSwapApplying = false;

// Only primitives and functions are carried over; an object (a DOM ref, a component instance) would
// be a stale reference in the recreated component, so it starts fresh
function isPreservableValue(value: unknown) {
  return value === null || typeof value !== "object";
}

function forgetSavedValues(componentId: string) {
  for (const key of savedValues.keys()) {
    if (key.startsWith(`${componentId}:`)) {
      savedValues.delete(key);
    }
  }
}

const state = {
  // How many OTHER instances were live when this one started: only a singleton is restored, so list
  // rows never share a key
  enter(componentId: string) {
    const others = liveInstanceCounts.get(componentId) ?? 0;
    liveInstanceCounts.set(componentId, others + 1);
    return others;
  },
  exit(componentId: string) {
    const remaining = (liveInstanceCounts.get(componentId) ?? 1) - 1;
    if (remaining > 0) {
      liveInstanceCounts.set(componentId, remaining);
      return;
    }

    liveInstanceCounts.delete(componentId);

    if (!isHotSwapApplying) {
      forgetSavedValues(componentId);
    }
  },
  restore(key: string, otherLiveInstances: number, initial: unknown) {
    const isRestorable = otherLiveInstances === 0 && savedValues.has(key);
    return isRestorable ? savedValues.get(key) : initial;
  },
  save(key: string, value: unknown) {
    if (!isPreservableValue(value)) {
      savedValues.delete(key);
      return;
    }

    savedValues.set(key, value);
  },
  // Svelte returns an existing proxy from $state() unchanged, so handing back the first one keeps the
  // store's data while the module's $derived recompute with the new code
  adoptModuleState(key: string, createInitial: () => unknown) {
    return moduleStates.has(key) ? moduleStates.get(key) : createInitial();
  },
  rememberModuleState(key: string, value: unknown) {
    if (!moduleStates.has(key)) {
      moduleStates.set(key, value);
    }
  }
};

// Svelte flushes a swap's recreations in a microtask, so all of them have run by the second frame
function holdStateThroughHotSwap() {
  isHotSwapApplying = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    isHotSwapApplying = false;
  }));
}

globalThis.ytdlDevHmr = {
  createHotContext,
  state
};

function isExtensionAlive() {
  return Boolean(extensionApi.runtime.id);
}

function reloadPage(reason: string) {
  console.info(`[YTDL HMR] reloading the page: ${reason}`);
  location.reload();
}

async function fetchManifest() {
  const response = await fetch(`${extensionApi.runtime.getURL(HMR_CONFIG.manifestPath)}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    return undefined;
  }

  const manifest: HmrManifestShape = await response.json();
  return manifest;
}

async function importFresh(modulePath: string) {
  return import(`${extensionApi.runtime.getURL(modulePath)}?t=${Date.now()}`);
}

// A component never imported yet has no accept callback: it loads the current code when first used
async function importChanged({ changedIds, manifest }: { changedIds: string[]; manifest: HmrManifestShape }) {
  return Promise.all(
           changedIds.map(async id => {
    const callback = acceptCallbacks.get(id);
    if (!callback) {
      return {
         id,
         callback,
         module: undefined,
         error: undefined 
      };
    }

    return importFresh(manifest.modules[id].url).then(
      module => ({
         id,
         callback,
         module,
         error: undefined 
      }),
      (error: unknown) => ({
         id,
         callback,
         module: undefined,
         error 
      })
    );
  })
         );
}

const STYLE_ELEMENT_ID = "ytdl-hmr-styles";

function ownStyles(manifest: HmrManifestShape) {
  return manifest.styles[globalThis.ytdlDevHmrEntry ?? ""];
}

// The global stylesheets of this entrypoint, applied after the prod ones so a rule edited in place wins
async function applyStyles(styles: { urls: string[] }) {
  const texts = await Promise.all(
                        styles.urls.map(async url => {
    const response = await fetch(`${extensionApi.runtime.getURL(url)}?t=${Date.now()}`, { cache: "no-store" });
    return response.text();
  })
                      );
  const element = document.getElementById(STYLE_ELEMENT_ID) ?? document.createElement("style");
  element.id = STYLE_ELEMENT_ID;
  element.textContent = texts.join("\n");
  (document.head ?? document.documentElement).append(element);
}

async function applyHotUpdates({ previous, next }: { previous: HmrManifestShape; next: HmrManifestShape }) {
  if (previous.vendorHash !== next.vendorHash) {
    reloadPage("the dependency graph changed");
    return;
  }

  const styles = ownStyles(next);
  if (styles && ownStyles(previous)?.hash !== styles.hash) {
    await applyStyles(styles);
  }

  const changedIds = Object.keys(next.modules).filter(id => previous.modules[id]?.hash !== next.modules[id].hash);
  const imports = await importChanged({
     changedIds,
     manifest: next 
  });
  const failed = imports.find(item => item.error !== undefined);
  if (failed) {
    console.error(`[YTDL HMR] importing ${failed.id} failed`, failed.error);
    reloadPage(`importing ${failed.id} failed`);
    return;
  }

  holdStateThroughHotSwap();
  for (const { id, callback, module } of imports) {
    if (!callback) {
      continue;
    }

    try {
      callback(module);
    } catch (error) {
      console.error(`[YTDL HMR] swapping ${id} threw`, error);
      reloadPage(`swapping ${id} threw`);
      return;
    }
  }
}

async function pause(milliseconds: number) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function pollManifest() {
  let current = await fetchManifest().catch(() => undefined);
  while (isExtensionAlive()) {
    await pause(HMR_CONFIG.pollIntervalMs);
    const next = await fetchManifest().catch(() => undefined);
    if (!next || !current) {
      current ??= next;
      continue;
    }

    const isChanged = JSON.stringify(next.modules) !== JSON.stringify(current.modules) || next.vendorHash !== current.vendorHash || ownStyles(next)?.hash !== ownStyles(current)?.hash;
    if (!isChanged) {
      continue;
    }

    const previous = current;
    current = next;
    await applyHotUpdates({
       previous,
       next 
    }).catch((error: unknown) => console.error("[YTDL HMR] update failed", error));
  }
}

pollManifest().catch((error: unknown) => console.error("[YTDL HMR] polling stopped", error));
