/**
 * Restarts the extension background in place with the rebuilt script, on Chrome and Firefox alike,
 * instead of reloading the extension (which orphans every content script in the open tabs). The
 * script is evaluated in the running background through the browser target (CDP on Chrome's service
 * worker, RDP on Firefox's event page); its prelude (hmr/runtime/background-prelude.ts) first undoes
 * the previous copy's listeners, ports and timers.
 *
 * Chrome keeps running a service worker from the script it cached at install, so once the worker is
 * stopped it would come back with the old code. A guard keeps the background awake with an extension
 * API call and re-applies the swapped script whenever it finds a background without it.
 */

import { sha1 } from "#scripts/dev/hmr/config.ts";
import { EXTENSION_API_SOURCE, type ReloadTarget } from "./reload-actions.ts";
import { setTimeout as delay } from "node:timers/promises";

// Under the 30 s after which an idle MV3 background is stopped
const GUARD_INTERVAL_MS = 20_000;
const RUNNING_VERSION_SOURCE = `(async () => {
  await ${EXTENSION_API_SOURCE}.runtime.getPlatformInfo();
  return globalThis.ytdlDevBackground?.version ?? null;
})()`;

export function createBackgroundSwapper({ reloadTarget, onLog }: {
  reloadTarget: ReloadTarget;
  onLog: (message: string) => void;
}) {
  let swappedScript = "";
  let swappedVersion: string | undefined;
  let isGuardRunning = false;

  async function applySwappedScript(version: string) {
    await reloadTarget.runScriptInBackground(`${swappedScript}\n;globalThis.ytdlDevBackground.version = ${JSON.stringify(version)};`);
  }

  async function checkBackground(version: string) {
    const runningVersion = await reloadTarget.evaluateInBackground<string | null>(RUNNING_VERSION_SOURCE).catch(() => version);
    if (runningVersion === version) {
      return;
    }

    onLog("The background restarted from the installed build - re-applying the swapped one");
    await applySwappedScript(version).catch((error: unknown) => onLog(`Re-applying the swapped background failed: ${String(error)}`));
  }

  async function guardSwappedBackground() {
    isGuardRunning = true;
    while (swappedVersion) {
      await delay(GUARD_INTERVAL_MS);

      if (swappedVersion) {
        await checkBackground(swappedVersion);
      }
    }
    isGuardRunning = false;
  }

  return {
    async swap(script: string) {
      const version = sha1(script);
      swappedScript = script;
      swappedVersion = version;
      await applySwappedScript(version);

      if (!isGuardRunning) {
        guardSwappedBackground().catch((error: unknown) => onLog(`Background guard stopped: ${String(error)}`));
      }
    },
    // A full extension reload installs the current build, so there is nothing left to guard
    forget() {
      swappedVersion = undefined;
    }
  };
}
