// The in-page half of the dev HMR. Loaded as an ES module by the dev loaders in the popup page and in
// every YouTube frame the content script runs in, on Chrome and Firefox alike - it only needs `fetch`
// and dynamic `import` of the extension's own files.
//
//  - installs globalThis.ytdlDevHmr.createHotContext, which the HMR-compiled `.svelte` modules call as
//    their `import.meta.hot`; Svelte registers one accept callback per component there
//  - polls the HMR manifest the dev server rewrites after every HMR build (a fetch of an extension
//    file works in both browsers; Chrome 147+ blocks a public page's connection to loopback, so no
//    socket is used) and re-imports every component whose hash moved, then runs its accept callback
//  - when the swap can't be applied (the dependency graph was re-split, a re-import failed, a callback
//    threw) it reloads the page, which loads the freshly built modules
//  - keeps component and module `$state` across a swap (the registry under `state`)
//
// HMR_CONFIG is prepended by the dev server from the serde struct PayloadConfig.

/** @typedef {{ url: string, hash: string }} ManifestModule */
/** @typedef {{ urls: string[], hash: string }} ManifestStyles */
/** @typedef {{ vendorHash: string, styles: Record<string, ManifestStyles>, modules: Record<string, ManifestModule>, entries: Record<string, string>, restartHash: string }} HmrManifestShape */
/** @typedef {(module: unknown) => void} AcceptCallback */

function getExtensionApi() {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api) {
    throw new Error("[YTDL HMR] no extension API in this context");
  }

  return api;
}

const extensionApi = getExtensionApi();

/** @type {Map<string, AcceptCallback>} */
const acceptCallbacks = new Map();

function noop() {}

/** @param {string} moduleId */
function createHotContext(moduleId) {
  return {
    /** @param {AcceptCallback} callback */
    accept(callback) {
      acceptCallbacks.set(moduleId, callback);
    },
    /** @param {unknown} _exports @param {AcceptCallback} [callback] */
    acceptExports(_exports, callback) {
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

// The $state registry the build-time rewrites call: a recreated component re-reads its primitives, a
// re-imported module adopts its first store
/** @type {Map<string, unknown>} */
const savedValues = new Map();
/** @type {Map<string, unknown>} */
const moduleStates = new Map();
/** @type {Map<string, number>} */
const liveInstanceCounts = new Map();
let isHotSwapApplying = false;

// Only primitives and functions are carried over; an object (a DOM ref, a component instance) would
// be a stale reference in the recreated component, so it starts fresh
/** @param {unknown} value */
function isPreservableValue(value) {
  return value === null || typeof value !== "object";
}

/** @param {string} componentId */
function forgetSavedValues(componentId) {
  for (const key of savedValues.keys()) {
    if (key.startsWith(`${componentId}:`)) {
      savedValues.delete(key);
    }
  }
}

const state = {
  // How many OTHER instances were live when this one started: only a singleton is restored, so list
  // rows never share a key
  /** @param {string} componentId */
  enter(componentId) {
    const others = liveInstanceCounts.get(componentId) ?? 0;
    liveInstanceCounts.set(componentId, others + 1);
    return others;
  },
  /** @param {string} componentId */
  exit(componentId) {
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
  /** @param {string} key @param {number} otherLiveInstances @param {unknown} initial */
  restore(key, otherLiveInstances, initial) {
    const isRestorable = otherLiveInstances === 0 && savedValues.has(key);
    return isRestorable ? savedValues.get(key) : initial;
  },
  /** @param {string} key @param {unknown} value */
  save(key, value) {
    if (!isPreservableValue(value)) {
      savedValues.delete(key);
      return;
    }

    savedValues.set(key, value);
  },
  // Svelte returns an existing proxy from $state() unchanged, so handing back the first one keeps the
  // store's data while the module's $derived recompute with the new code
  /** @param {string} key @param {() => unknown} createInitial */
  adoptModuleState(key, createInitial) {
    return moduleStates.has(key) ? moduleStates.get(key) : createInitial();
  },
  /** @param {string} key @param {unknown} value */
  rememberModuleState(key, value) {
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

// A YouTube page is never reloaded: it keeps the code it has until the next save applies
/** @param {string} reason */
function reloadPage(reason) {
  if (globalThis.ytdlDevHmrEntry === "youtube") {
    console.warn(`[YTDL HMR] not applied, reload the page yourself to pick it up: ${reason}`);
    return;
  }

  console.info(`[YTDL HMR] reloading the page: ${reason}`);
  location.reload();
}

/** @returns {Promise<HmrManifestShape | undefined>} */
async function fetchManifest() {
  const response = await fetch(`${extensionApi.runtime.getURL(HMR_CONFIG.manifestPath)}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    return undefined;
  }

  return response.json();
}

/** @param {string} modulePath */
async function importFresh(modulePath) {
  return import(`${extensionApi.runtime.getURL(modulePath)}?t=${Date.now()}`);
}

// A component never imported yet has no accept callback: it loads the current code when first used
/** @param {{ changedIds: string[], manifest: HmrManifestShape }} options */
async function importChanged({ changedIds, manifest }) {
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
        /** @param {unknown} error */
        error => ({
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

/** @param {HmrManifestShape} manifest */
function ownStyles(manifest) {
  return manifest.styles[globalThis.ytdlDevHmrEntry ?? ""];
}

// The global stylesheets of this entrypoint, applied after the prod ones so a rule edited in place wins
/** @param {{ urls: string[] }} styles */
async function applyStyles(styles) {
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

// Mount points the content script made by hand, which its context's invalidation leaves behind
const OWN_UI_SELECTOR = "[data-ytdl-item], [data-ytdl-grid-item], [data-ytdl-playlist-downloader], [data-ytdl-watch-snackbar]";

// The page script announces the download panel once; a restarted content script has to hear it again
const MESSAGE_EVENT = "@webext-core/messaging/custom-events";
const REPLAYED_MESSAGE_TYPE = "panelContentReady";
const MESSAGE_ID_RANGE = 1_000_000_000;
/** @type {{ message: { type: string, id: number } } | undefined} */
let panelAnnouncement;
addEventListener(MESSAGE_EVENT, event => {
  const { detail } = /** @type {CustomEvent} */ (event);
  if (detail?.message?.type === REPLAYED_MESSAGE_TYPE) {
    panelAnnouncement = detail;
  }
});

function replayPanelAnnouncement() {
  if (!panelAnnouncement) {
    return;
  }

  const message = {
    ...panelAnnouncement.message,
    id: Math.floor(Math.random() * MESSAGE_ID_RANGE)
  };
  dispatchEvent(new CustomEvent(MESSAGE_EVENT, {
    detail: {
      ...panelAnnouncement,
      message
    }
  }));
}

// The old run is stopped before its UI goes, or its observers put the UI straight back
/** @param {HmrManifestShape} manifest */
async function restartContentScript(manifest) {
  const entry = await importFresh(manifest.entries[globalThis.ytdlDevHmrEntry ?? ""]);
  globalThis.ytdlDevContentContext?.notifyInvalidated();
  const disposers = globalThis.ytdlDevRunDisposers ?? [];
  for (const dispose of disposers) {
    dispose();
  }

  for (const element of document.querySelectorAll(OWN_UI_SELECTOR)) {
    element.remove();
  }

  await entry.run();
  replayPanelAnnouncement();
  console.info(`[YTDL HMR] content script restarted in place - removed ${disposers.length} message handlers`);
}

/** @param {{ previous: HmrManifestShape, next: HmrManifestShape }} options */
async function applyHotUpdates({ previous, next }) {
  const isGraphChanged = previous.vendorHash !== next.vendorHash;
  const isContentScript = globalThis.ytdlDevHmrEntry === "youtube";
  if (isGraphChanged && !isContentScript) {
    reloadPage("the dependency graph changed");
    return;
  }

  const styles = ownStyles(next);
  if (styles && ownStyles(previous)?.hash !== styles.hash) {
    await applyStyles(styles);
  }

  const changedIds = Object.keys(next.modules).filter(id => previous.modules[id]?.hash !== next.modules[id].hash);
  // A restart imports the entry afresh, so a re-split graph needs nothing else
  const isRestartNeeded = isContentScript && (isGraphChanged || previous.restartHash !== next.restartHash);
  if (isRestartNeeded) {
    await restartContentScript(next).catch(
      /** @param {unknown} error */
      error => {
        console.error("[YTDL HMR] restarting the content script failed", error);
        reloadPage("the content script restart failed");
      }
    );
    return;
  }

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

/** @param {number} milliseconds */
async function pause(milliseconds) {
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

    const isChanged = next.restartHash !== current.restartHash || JSON.stringify(next.modules) !== JSON.stringify(current.modules) || next.vendorHash !== current.vendorHash || ownStyles(next)?.hash !== ownStyles(current)?.hash;
    if (!isChanged) {
      continue;
    }

    const previous = current;
    current = next;
    await applyHotUpdates({
       previous,
       next 
    }).catch(error => console.error("[YTDL HMR] update failed", error)
    );
  }
}

pollManifest().catch(error => console.error("[YTDL HMR] polling stopped", error)
);
