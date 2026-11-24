/**
 * Chrome side of the dev server's hot reload. The extension is (re)loaded over web-ext-run's CDP pipe
 * (Extensions.loadUnpacked, a full reload that re-reads the manifest); everything else runs over the
 * dev browser's --remote-debugging-port.
 *
 * Reloading the extension orphans the content scripts already running in open tabs: Chrome keeps
 * their isolated world alive but cuts it off from the extension, and never re-injects declared
 * scripts into existing pages. So before re-injecting, each orphaned world is neutralized - its WXT
 * context is invalidated (unmounting its UI) and the listeners it left on window/document are removed,
 * so it can't answer the page's cross-world messages alongside the fresh copy.
 */

import {
  type CdpTarget,
  closeTarget,
  evaluateOnTarget,
  fetchTargets,
  openCdpSession,
  requireDebuggerUrl
} from "#scripts/cdp-utils.ts";
import { neutralizeOrphanedWorldsInPage } from "./worlds.ts";
import { FileExtension } from "#scripts/dev/enums.ts";
import { matchesUrlPattern } from "#scripts/dev/output/manifest.ts";
import {
  buildTabUpdateSource,
  type ExtensionReloadPlan,
  PageAction,
  type PageRefreshPlan,
  type RefreshedPage,
  type ReloadTarget,
  type TabUpdateResult
} from "#scripts/dev/browsers/reload-actions.ts";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const SERVICE_WORKER_WAIT_MS = 10_000;
const SERVICE_WORKER_POLL_MS = 200;
const EXTENSION_URL_PREFIX = "chrome-extension://";
const CdpTargetType = {
  Page: "page",
  // How CDP lists the offscreen document
  BackgroundPage: "background_page",
  ServiceWorker: "service_worker"
} as const;

interface ChromeReloadTargetOptions {
  cdpPort: number;
  // The manifest name - Chrome names a content script's isolated world after it
  extensionName: string;
  reloadExtensionOverPipe: () => Promise<unknown>;
}

function isExtensionServiceWorker(target: CdpTarget) {
  return target.type === CdpTargetType.ServiceWorker &&
    (target.url ?? "").startsWith(EXTENSION_URL_PREFIX) &&
    Boolean(target.webSocketDebuggerUrl);
}

function extensionIdOf(target: CdpTarget) {
  return new URL(target.url ?? "").host;
}

async function listTargets(cdpPort: number) {
  return fetchTargets(cdpPort).catch(() => []);
}

export function createChromeReloadTarget({ cdpPort, extensionName, reloadExtensionOverPipe }: ChromeReloadTargetOptions) {
  let extensionId: string | undefined;

  // The dev profile may carry other extensions whose worker is also background.js, so the first match
  // is by manifest name; after that, by id
  async function isOwnServiceWorker(target: CdpTarget) {
    if (extensionId) {
      return extensionIdOf(target) === extensionId;
    }

    const name = await evaluateOnTarget<string>(requireDebuggerUrl(target), "chrome.runtime.getManifest().name")
      .catch(() => undefined);
    if (name !== extensionName) {
      return false;
    }

    extensionId = extensionIdOf(target);
    return true;
  }

  // `staleTargetId` skips the worker a reload is tearing down
  async function findServiceWorker(staleTargetId?: string) {
    const deadline = performance.now() + SERVICE_WORKER_WAIT_MS;
    while (performance.now() < deadline) {
      const candidates = (await listTargets(cdpPort)).filter(target =>
        isExtensionServiceWorker(target) && target.id !== staleTargetId);
      for (const target of candidates) {
        if (await isOwnServiceWorker(target)) {
          return target;
        }
      }

      await delay(SERVICE_WORKER_POLL_MS);
    }

    throw new Error(`the ${extensionName} service worker did not come up within ${SERVICE_WORKER_WAIT_MS}ms`);
  }

  async function neutralizeOrphanedContentScripts(plan: ExtensionReloadPlan) {
    const patterns = plan.isolatedContentScripts.flatMap(entry => entry.matches);
    const pages = (await listTargets(cdpPort)).filter(target =>
      target.type === CdpTargetType.Page &&
      target.webSocketDebuggerUrl &&
      patterns.some(pattern => matchesUrlPattern({
         url: target.url ?? "",
         pattern 
      })));
    await Promise.all(
            pages.map(page => neutralizeOrphanedWorldsInPage({
      page,
      worldName: extensionName
    }).catch((error: unknown) => {
      console.warn(`Could not neutralize the orphaned content scripts in ${page.url}: ${String(error)}`);
    }))
          );
  }

  async function reloadExtension(plan: ExtensionReloadPlan) {
    const staleServiceWorker = (await listTargets(cdpPort)).find(target =>
      isExtensionServiceWorker(target) && extensionIdOf(target) === extensionId);
    await reloadExtensionOverPipe();
    const serviceWorker = await findServiceWorker(staleServiceWorker?.id);
    await neutralizeOrphanedContentScripts(plan);
    const result = await evaluateOnTarget<TabUpdateResult>(requireDebuggerUrl(serviceWorker), buildTabUpdateSource(plan));
    if (!result) {
      throw new Error("the service worker returned no tab update result");
    }

    return result;
  }

  async function listAffectedPages({ pageNames, sharedAssetFiles }: PageRefreshPlan) {
    if (!extensionId) {
      await findServiceWorker();
    }

    return (await listTargets(cdpPort))
      .filter(target => (target.url ?? "").startsWith(`${EXTENSION_URL_PREFIX}${extensionId}/`))
      .map(target => ({
        target,
        name: basename(new URL(target.url ?? "").pathname, FileExtension.Html)
      }))
      .filter(({ target, name }) =>
        new URL(target.url ?? "").pathname.endsWith(FileExtension.Html) &&
        (sharedAssetFiles.length > 0 || pageNames.includes(name)));
  }

  // Pages open in a tab or the action popup reload in place; a document the background owns (the
  // offscreen document) is closed so the background recreates it from the new build on next use.
  // Frames inside those documents (download-worker iframes) go with their host.
  async function refreshPage(target: CdpTarget) {
    if (target.type === CdpTargetType.BackgroundPage) {
      await closeTarget(cdpPort, target.id);
      return PageAction.Closed;
    }

    if (target.type !== CdpTargetType.Page) {
      return undefined;
    }

    const session = await openCdpSession(requireDebuggerUrl(target));
    await session.send("Page.reload").finally(() => session.close());
    return PageAction.Reloaded;
  }

  async function refreshPages(plan: PageRefreshPlan) {
    const refreshedPages: RefreshedPage[] = [];
    for (const { target, name } of await listAffectedPages(plan)) {
      const action = await refreshPage(target);
      if (action) {
        refreshedPages.push({
          name,
          action
        });
      }
    }
    return refreshedPages;
  }

  async function evaluateInBackground<TValue>(expression: string) {
    const value = await evaluateOnTarget<TValue>(requireDebuggerUrl(await findServiceWorker()), expression);
    if (value === undefined) {
      throw new Error("the service worker returned no value");
    }

    return value;
  }

  // The completion value of a whole bundle is whatever its last statement left, so it is dropped
  async function runScriptInBackground(script: string) {
    await evaluateOnTarget(requireDebuggerUrl(await findServiceWorker()), `${script}\n;undefined`);
  }

  const target: ReloadTarget = {
    reloadExtension,
    refreshPages,
    evaluateInBackground,
    runScriptInBackground
  };
  return {
    ...target,
    // Resolves the extension id up front, while the freshly installed worker is still awake
    discoverExtension: async () => extensionIdOf(await findServiceWorker())
  };
}
