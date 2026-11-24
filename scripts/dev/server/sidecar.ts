import { type HotSidecarHandlers, startHotSidecar } from "#scripts/dev-bridge.ts";
import { createChromeReloadTarget } from "#scripts/dev/browsers/chrome/target.ts";
import { createFirefoxReloadTarget } from "#scripts/dev/browsers/firefox/target.ts";
import { createBackgroundSwapper } from "#scripts/dev/browsers/background-swap.ts";
import {
  type BackgroundSwapPlan,
  describeBackgroundSwap,
  describeExtensionReload,
  describePageRefresh,
  type ReloadTarget
} from "#scripts/dev/browsers/reload-actions.ts";
import { readBuiltManifest, readGeckoId } from "#scripts/dev/output/manifest.ts";
import {
  planReload,
  planStaleBackgroundReload,
  ReloadKind,
  type ReloadPlan,
  takeBuildSnapshot
} from "#scripts/dev/output/reload-plan.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildHmr, buildWithLockRetry } from "./build.ts";
import type { BrowserLaunch, WebExtRunner } from "./launch.ts";
import { formatElapsed, logEvent } from "./log.ts";
import {
  CDP_PORT,
  ENV_FILES,
  HMR_PORT_OFFSET,
  INSTALL_MARKER_PATH,
  INSTALLED_LOCKFILE_PATH,
  IS_FIREFOX,
  REBUILD_DEBOUNCE_MS,
  WATCH_POLL_INTERVAL_MS
} from "./options.ts";

// ── Hot reload ──────────────────────────────────────────────────────────────

export async function createReloadTarget({ runner, outputDir, profileDirectory }: BrowserLaunch & { runner: WebExtRunner }) {
  const builtManifest = readBuiltManifest(outputDir);
  function reloadExtensionOverRunner() {
    // web-ext-run ends its "Last extension reload" status line with \r, not a newline
    return runner.reloadAllExtensions().finally(() => process.stdout.write("\n"));
  }

  if (IS_FIREFOX) {
    const firefoxTarget = createFirefoxReloadTarget({
      profileDir: profileDirectory,
      extensionId: readGeckoId(builtManifest),
      reloadAddon: reloadExtensionOverRunner
    });
    const { debugPort = CDP_PORT, extensionId, extensionUuid } = await firefoxTarget.discoverConnection();
    return {
      reloadTarget: firefoxTarget,
      connection: {
        debugPort,
        extensionId,
        extensionUuid
      }
    };
  }

  const chromeTarget = createChromeReloadTarget({
    cdpPort: CDP_PORT,
    extensionName: builtManifest.name ?? "",
    reloadExtensionOverPipe: reloadExtensionOverRunner
  });
  await chromeTarget.discoverExtension().then(
    extensionId => console.log(`Extension id: ${extensionId}`),
    (error: unknown) => console.warn(`Could not find the extension's service worker yet: ${String(error)}`)
  );
  return {
    reloadTarget: chromeTarget,
    connection: {
       debugPort: CDP_PORT 
    }
  };
}

type SidecarConnection = Awaited<ReturnType<typeof createReloadTarget>>["connection"];

// Keeps a script ending in an expression without a semicolon from running into the next one
const SCRIPT_SEPARATOR = "\n;\n";

const HAS_DEV_PRELUDE_SOURCE = "typeof globalThis.ytdlDevBackground === \"object\"";

type BackgroundSwapper = ReturnType<typeof createBackgroundSwapper>;

function readBackgroundScript({ outputDir, plan }: { outputDir: string; plan: BackgroundSwapPlan }) {
  return plan.backgroundFiles.map(file => readFileSync(join(outputDir, file), "utf-8")).join(SCRIPT_SEPARATOR);
}

// A swap that fails (the background is unreachable, the new script throws) falls back to the reload
async function swapBackground({ plan, reloadTarget, backgroundSwapper, outputDir }: {
  plan: BackgroundSwapPlan;
  reloadTarget: ReloadTarget;
  backgroundSwapper: BackgroundSwapper;
  outputDir: string;
}) {
  const swapError = await backgroundSwapper.swap(
                            readBackgroundScript({
    outputDir,
    plan
  })
                          ).then(() => undefined, (error: unknown) => String(error));
  if (swapError) {
    backgroundSwapper.forget();
    const reload = describeExtensionReload({
      plan: plan.fallback,
      result: await reloadTarget.reloadExtension(plan.fallback)
    });
    return `Swapping the background in place failed (${swapError}) - ${reload}`;
  }

  return describeBackgroundSwap({
    plan,
    refreshedPages: plan.pageRefresh ? await reloadTarget.refreshPages(plan.pageRefresh) : []
  });
}

async function applyReloadPlan({ plan, reloadTarget, backgroundSwapper, outputDir }: {
  plan: ReloadPlan;
  reloadTarget: ReloadTarget;
  backgroundSwapper: BackgroundSwapper;
  outputDir: string;
}) {
  if (plan.kind === ReloadKind.None) {
    return "No output changes - skipped reload";
  }

  if (plan.kind === ReloadKind.RefreshPages) {
    return describePageRefresh({
      plan,
      refreshedPages: await reloadTarget.refreshPages(plan)
    });
  }

  if (plan.kind === ReloadKind.SwapBackground) {
    return swapBackground({
      plan,
      reloadTarget,
      backgroundSwapper,
      outputDir
    });
  }

  backgroundSwapper.forget();
  return describeExtensionReload({
    plan,
    result: await reloadTarget.reloadExtension(plan)
  });
}

// The Rust sidecar (dev-server/) owns the hot loop: it watches the sources, debounces, runs one
// rebuild at a time and calls back here. This side keeps what needs the browser and WXT: the build,
// and the output diff that picks the smallest update (output/reload-plan.ts), which the sidecar
// asks for after every build
function createSidecarHandlers({ outputDir, reloadTarget }: {
  outputDir: string;
  reloadTarget: ReloadTarget;
}) {
  let lastSnapshot = takeBuildSnapshot(outputDir);
  const backgroundSwapper = createBackgroundSwapper({
    reloadTarget,
    onLog: logEvent
  });

  return {
    async buildExtension() {
      await buildWithLockRetry();
      return {
        htmlEntrypoints: [],
        skippedEntrypoints: []
      };
    },
    async rebuildHmr() {
      const { sourceModules } = await buildHmr(outputDir);
      return { hmrSourceFiles: sourceModules };
    },
    async reloadExtension({ startedAtMs }) {
      const nextSnapshot = takeBuildSnapshot(outputDir);
      const plan = planReload({
        before: lastSnapshot,
        after: nextSnapshot
      });
      const outcome = await applyReloadPlan({
        plan,
        reloadTarget,
        backgroundSwapper,
        outputDir
      });
      logEvent(`${outcome} (${formatElapsed(Date.now() - startedAtMs)})`);
      lastSnapshot = nextSnapshot;
    },
    injectHmr: async () => true,
    async refreshEnv() {}
  } satisfies HotSidecarHandlers;
}

// The background's dev prelude is missing only when the browser ran a script it cached before this
// build; a background swap could not undo that copy's listeners, so it is replaced by one reload
export async function reloadIfBackgroundStale({ outputDir, reloadTarget }: {
  outputDir: string;
  reloadTarget: ReloadTarget;
}) {
  const hasDevPrelude = await reloadTarget.evaluateInBackground<boolean>(HAS_DEV_PRELUDE_SOURCE).catch(() => true);
  if (hasDevPrelude) {
    return;
  }

  const plan = planStaleBackgroundReload(readBuiltManifest(outputDir));
  logEvent(
    describeExtensionReload({
    plan,
    result: await reloadTarget.reloadExtension(plan)
  })
  );
}

export function startSidecar({ outputDir, reloadTarget, hmrSourceFiles, connection }: {
  outputDir: string;
  hmrSourceFiles: string[];
  reloadTarget: ReloadTarget;
  connection: SidecarConnection;
}) {
  return startHotSidecar({
    config: {
      projectRoot: PROJECT_ROOT,
      outputDir,
      browser: IS_FIREFOX ? "firefox" : "chromium",
      ...connection,
      hmrPort: CDP_PORT + HMR_PORT_OFFSET,
      watchPaths: ["src", "wxt.config.ts", INSTALL_MARKER_PATH, ...ENV_FILES],
      envFiles: ENV_FILES,
      installMarker: INSTALL_MARKER_PATH,
      installedLockfile: INSTALLED_LOCKFILE_PATH,
      skippedEntrypoints: [],
      htmlEntrypoints: [],
      hmrSourceFiles,
      debounceMs: REBUILD_DEBOUNCE_MS,
      pollIntervalMs: WATCH_POLL_INTERVAL_MS
    },
    handlers: createSidecarHandlers({
      outputDir,
      reloadTarget
    }),
    onLog: logEvent
  });
}
