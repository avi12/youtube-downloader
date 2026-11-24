/**
 * Firefox side of the dev server's hot reload, over RDP (the Firefox DevTools Remote Debugging
 * Protocol): Firefox's CDP endpoint lists no targets, so everything runs in the extension's own
 * background event page, where the tabs/scripting APIs live (rdp.ts).
 *
 * A reloaded add-on's old content-script sandboxes are destroyed without running any cleanup, so
 * before the reload the live ISOLATED scripts are told to tear down (their WXT context invalidates,
 * unmounting their UI); afterwards the fresh copies are injected in place.
 */

import type { ContentScriptEntry } from "#scripts/dev/output/manifest.ts";
import {
  buildTabUpdateSource,
  EXTENSION_API_SOURCE,
  type ExtensionReloadPlan,
  PageAction,
  type PageRefreshPlan,
  type ReloadTarget,
  type TabUpdateResult,
  WXT_SCRIPT_STARTED_EVENT_SUFFIX,
  WXT_SCRIPT_STARTED_MESSAGE_ID
} from "#scripts/dev/browsers/reload-actions.ts";
import { evaluateInBackground, findAddonUuid, runScriptInBackground } from "./background.ts";
import { findFirefoxRdpPort } from "./rdp-client.ts";
import { setTimeout as delay } from "node:timers/promises";

const BACKGROUND_RETRY_ATTEMPTS = 5;
const BACKGROUND_RETRY_DELAY_MS = 1000;

// Tell every live ISOLATED content script to tear down before the add-on reload destroys its sandbox
// without running cleanup: the WXT "newer script started" event invalidates its context, which
// unmounts its UI. Runs in the content-script sandbox via scripting.executeScript.
function buildTeardownSource(isolatedContentScripts: ContentScriptEntry[]) {
  const contentScriptNames = [...new Set(isolatedContentScripts.flatMap(entry => entry.names))];
  const patterns = [...new Set(isolatedContentScripts.flatMap(entry => entry.matches))];
  return `(async () => {
    const api = ${EXTENSION_API_SOURCE};
    const events = ${JSON.stringify(contentScriptNames)}.map(contentScriptName => [api.runtime.id + ":" + contentScriptName + ${JSON.stringify(WXT_SCRIPT_STARTED_EVENT_SUFFIX)}, contentScriptName]);
    let tornDownTabCount = 0;
    for (const tab of await api.tabs.query({ url: ${JSON.stringify(patterns)}, status: "complete" })) {
      if (tab.discarded) {
        continue;
      }

      await api.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: "ISOLATED",
        args: [events, ${JSON.stringify(WXT_SCRIPT_STARTED_MESSAGE_ID)}],
        func: (scriptStartedEvents, messageId) => {
          for (const [eventName, contentScriptName] of scriptStartedEvents) {
            document.dispatchEvent(new CustomEvent(eventName, { detail: { contentScriptName, messageId } }));
          }
        }
      }).then(() => tornDownTabCount++, () => {});
    }
    return tornDownTabCount;
  })()`;
}

function buildPageRefreshSource({ pageNames, sharedAssetFiles }: PageRefreshPlan) {
  return `(async () => {
    const api = ${EXTENSION_API_SOURCE};
    const pageNames = ${JSON.stringify(pageNames)};
    const refreshedPages = [];
    for (const view of api.extension.getViews()) {
      const name = view.location.pathname.replace(/^\\//, "").replace(/\\.html$/, "");
      if (view === globalThis || (!${sharedAssetFiles.length > 0} && !pageNames.includes(name))) {
        continue;
      }

      // An iframe the background hosts (the offscreen document's stand-in) is removed so the
      // background recreates it on next use; a popup or tab reloads in place
      const isClosed = Boolean(view.frameElement);
      if (isClosed) {
        view.frameElement.remove();
      } else {
        view.location.reload();
      }

      refreshedPages.push({ name, isClosed });
    }
    return refreshedPages;
  })()`;
}

export function createFirefoxReloadTarget({ profileDir, extensionId, reloadAddon }: {
  profileDir: string;
  // The gecko id - Firefox's runtime.id and RDP's addon id
  extensionId: string;
  reloadAddon: () => Promise<unknown>;
}) {
  function evaluate<TValue>(source: string) {
    return evaluateInBackground<TValue>({
      profileDir,
      extensionId,
      source
    });
  }

  // Right after a reload the add-on (and its background) is still starting up
  async function evaluateOnceRestarted<TValue>(source: string) {
    for (let attempt = 1; ; attempt++) {
      const outcome = await evaluate<TValue>(source).then(
        value => ({ value }),
        (error: unknown) => ({ error })
      );
      if ("value" in outcome) {
        return outcome.value;
      }

      if (attempt >= BACKGROUND_RETRY_ATTEMPTS) {
        throw outcome.error;
      }

      await delay(BACKGROUND_RETRY_DELAY_MS);
    }
  }

  const target: ReloadTarget = {
    async reloadExtension(plan: ExtensionReloadPlan) {
      await evaluate<number>(buildTeardownSource(plan.isolatedContentScripts)).catch(() => 0);
      await reloadAddon();
      return evaluateOnceRestarted<TabUpdateResult>(buildTabUpdateSource(plan));
    },
    async refreshPages(plan: PageRefreshPlan) {
      const refreshedPages = await evaluate<{
        name: string;
        isClosed: boolean;
      }[]>(buildPageRefreshSource(plan));
      return refreshedPages.map(({ name, isClosed }) => ({
        name,
        action: isClosed ? PageAction.Closed : PageAction.Reloaded
      }));
    },
    evaluateInBackground: evaluate,
    async runScriptInBackground(script: string) {
      await runScriptInBackground({
        profileDir,
        extensionId,
        script
      });
    }
  };
  return {
    ...target,
    // What the sidecar needs to reach the add-on itself over RDP
    async discoverConnection() {
      return {
        debugPort: findFirefoxRdpPort(profileDir),
        extensionId,
        extensionUuid: await findAddonUuid({
          profileDir,
          extensionId
        }).catch(() => undefined)
      };
    }
  };
}
