/**
 * Dev server: production builds + one long-lived browser with the extension sideloaded.
 *
 * The Rust sidecar in dev-server/ watches the sources and applies the smallest update that makes a
 * change live - a page or the extension is only reloaded when nothing else can work:
 *   - popup or ISOLATED content-script components and side-effect-free modules: hot-swapped in place
 *     by the HMR runtime (hmr/), `$state` kept
 *   - anything else rebuilds and is diffed against the previous build (output/reload-plan.ts):
 *   - background only: restarted in place inside the running extension (browsers/background-swap.ts)
 *   - extension pages only (offscreen, mux worker): reload the open page or close the offscreen
 *     document; the extension and the tabs are untouched
 *   - ISOLATED content script entry, manifest: reload the extension and re-run the ISOLATED content
 *     scripts in the open tabs in place, so the page and the playing video survive
 *   - MAIN-world content script: reload the extension and the tabs it runs in - a script living in
 *     the page itself can't be torn down and run again
 * The browser stays open across every rebuild. Dev builds add the `scripting` permission so the
 * extension's background can re-inject its content scripts, plus the patches in output/patches.ts.
 *
 * Usage:
 *   tsx scripts/dev/server/main.ts [--firefox] [--cdp-port <port>] [--marionette-port <port>]
 *                             [--profile-dir <dir>] [--out-dir <dir>] [--start-url <url>] [--mute-audio]
 * Each flag falls back to an env var (YTDL_DEV_CDP_PORT, YTDL_DEV_MARIONETTE_PORT, YTDL_DEV_PROFILE_DIR,
 * YTDL_DEV_OUT_DIR, YTDL_DEV_START_URL), so a second dev server can run beside the first on its own
 * debug port, profile and output dir.
 */

import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { buildHmr, buildWithLockRetry } from "./build.ts";
import { launchChrome, launchFirefox, type WebExtRunner } from "./launch.ts";
import { installProcessDiagnostics, quietWebExtLogs } from "./log.ts";
import { CDP_PORT, IS_FIREFOX, PROFILE_PLATFORM_SUFFIX } from "./options.ts";
import {
  killExistingFirefoxInstances,
  killExistingLinuxChromeInstances,
  setupChromeProfile,
  setupFirefoxProfile
} from "./profiles.ts";
import { createReloadTarget, reloadIfBackgroundStale, startSidecar } from "./sidecar.ts";
import { existsSync } from "node:fs";
import { delimiter, relative, resolve } from "node:path";

const platformNodeModules = resolve(PROJECT_ROOT, `node_modules-${PROFILE_PLATFORM_SUFFIX}`);
if (existsSync(platformNodeModules)) {
  const existingNodePath = process.env.NODE_PATH ?? "";
  process.env.NODE_PATH = existingNodePath
    ? `${platformNodeModules}${delimiter}${existingNodePath}`
    : platformNodeModules;
}

function registerShutdown({ sidecar, runner }: {
  sidecar: ReturnType<typeof startSidecar>;
  runner: WebExtRunner;
}) {
  let isExiting = false;
  async function exit() {
    if (isExiting) {
      return;
    }

    isExiting = true;
    await sidecar.shutdown().catch(() => {});
    await runner.exit().catch(() => {});
    process.exit(0);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      exit().catch(() => process.exit(1));
    });
  }

  runner.registerCleanup(() => {
    console.log("\nBrowser closed. Exiting.");
    exit().catch(() => process.exit(1));
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.chdir(PROJECT_ROOT);
  installProcessDiagnostics();

  if (IS_FIREFOX) {
    killExistingFirefoxInstances();
  } else {
    killExistingLinuxChromeInstances();
  }

  const browserName = IS_FIREFOX ? "Firefox" : "Chrome";
  const profileDirectory = IS_FIREFOX ? setupFirefoxProfile() : setupChromeProfile();

  console.log(`Building extension for ${browserName} (production)...`);
  const outputDir = await buildWithLockRetry();
  const { sourceModules: hmrSourceFiles } = await buildHmr(outputDir);
  console.log(`Build complete: ${relative(PROJECT_ROOT, outputDir)}\n`);

  quietWebExtLogs();
  const browserLaunch = {
    outputDir,
    profileDirectory
  };
  const runner = await (IS_FIREFOX ? launchFirefox(browserLaunch) : launchChrome(browserLaunch));
  console.log(`${browserName} launched with extension sideloaded (debug port ${CDP_PORT}, profile ${relative(PROJECT_ROOT, profileDirectory)}).`);

  const { reloadTarget, connection } = await createReloadTarget({
    ...browserLaunch,
    runner
  });
  await reloadIfBackgroundStale({
    outputDir,
    reloadTarget
  });
  const sidecar = startSidecar({
    outputDir,
    hmrSourceFiles,
    reloadTarget,
    connection
  });
  console.log("Watching for file changes...\n");
  registerShutdown({
    sidecar,
    runner
  });
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
