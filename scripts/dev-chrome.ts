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
  type CdpSession,
  type CdpTarget,
  closeTarget,
  evaluateOnTarget,
  fetchTargets,
  openCdpSession
} from "./cdp-utils.ts";
import { matchesUrlPattern } from "./dev-output-changes.ts";
import {
  buildTabUpdateSource,
  type ExtensionReloadPlan,
  PageAction,
  type PageRefreshPlan,
  type RefreshedPage,
  type ReloadTarget,
  type TabUpdateResult,
  WXT_SCRIPT_STARTED_EVENT_SUFFIX,
  WXT_SCRIPT_STARTED_MESSAGE_ID
} from "./dev-reload-actions.ts";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const SERVICE_WORKER_WAIT_MS = 10_000;
const SERVICE_WORKER_POLL_MS = 200;
const EXTENSION_URL_PREFIX = "chrome-extension://";
const HTML_EXTENSION = ".html";
const CdpTargetType = {
  Page: "page",
  // How CDP lists the offscreen document
  BackgroundPage: "background_page",
  ServiceWorker: "service_worker"
} as const;
const ISOLATED_WORLD_TYPE = "isolated";
// An isolated world whose extension was reloaded keeps running but loses its runtime id
const ORPHANED_WORLD_PROBE = "typeof chrome === \"undefined\" || !chrome.runtime?.id";
// DOMDebugger hands back listener functions only for objects that belong to an object group
const OBJECT_GROUP = "ytdl-dev-server";
const REMOVE_LISTENER_FUNCTION = "function (type, handler, useCapture) { this.removeEventListener(type, handler, useCapture); }";
// Calls an orphan's own WXT "newer script started" listener with the event it waits for. Dispatching
// the event instead would reach every world's listener, invalidating a live copy as well.
const INVOKE_SCRIPT_STARTED_LISTENER_FUNCTION = `function (handler, type, contentScriptName, messageId) {
  handler.call(this, new CustomEvent(type, { detail: { contentScriptName, messageId } }));
}`;

type ExecutionContext = {
  id: number;
  name?: string;
  auxData?: { type?: string };
};

type RemoteObject = { objectId?: string };

type EventListenerInfo = {
  type: string;
  useCapture: boolean;
  handler?: RemoteObject;
  originalHandler?: RemoteObject;
};

type ChromeReloadTargetOptions = {
  cdpPort: number;
  // The manifest name - Chrome names a content script's isolated world after it
  extensionName: string;
  reloadExtensionOverPipe: () => Promise<unknown>;
};

function isExtensionServiceWorker(target: CdpTarget) {
  return target.type === CdpTargetType.ServiceWorker &&
    (target.url ?? "").startsWith(EXTENSION_URL_PREFIX) &&
    Boolean(target.webSocketDebuggerUrl);
}

function extensionIdOf(target: CdpTarget) {
  return new URL(target.url ?? "").host;
}

async function listTargets(cdpPort: number) {
  return fetchTargets(cdpPort).catch((): CdpTarget[] => []);
}

function handlerObjectIdOf({ originalHandler, handler }: EventListenerInfo) {
  return (originalHandler ?? handler)?.objectId;
}

async function listWorldListeners({ session, objectId }: {
  session: CdpSession;
  objectId: string;
}) {
  const { listeners } = await session.send<{ listeners: EventListenerInfo[] }>("DOMDebugger.getEventListeners", { objectId });
  return listeners.flatMap(listener => {
    const handlerObjectId = handlerObjectIdOf(listener);
    return handlerObjectId
      ? [{
        ...listener,
        handlerObjectId
      }]
      : [];
  });
}

// Invalidates the world's WXT content-script contexts, which unmounts every UI and runs every
// onInvalidated cleanup the scripts registered
async function invalidateWxtContexts({ session, objectId }: {
  session: CdpSession;
  objectId: string;
}) {
  const listeners = await listWorldListeners({
    session,
    objectId
  });
  for (const listener of listeners.filter(({ type }) => type.endsWith(WXT_SCRIPT_STARTED_EVENT_SUFFIX))) {
    const [, contentScriptName] = listener.type.split(":");
    await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: INVOKE_SCRIPT_STARTED_LISTENER_FUNCTION,
      arguments: [
        { objectId: listener.handlerObjectId },
        { value: listener.type },
        { value: contentScriptName },
        { value: WXT_SCRIPT_STARTED_MESSAGE_ID }
      ]
    });
  }
}

async function removeWorldListeners({ session, objectId }: {
  session: CdpSession;
  objectId: string;
}) {
  for (const listener of await listWorldListeners({
    session,
    objectId
  })) {
    await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: REMOVE_LISTENER_FUNCTION,
      arguments: [{ value: listener.type }, { objectId: listener.handlerObjectId }, { value: listener.useCapture }]
    });
  }
}

// Shut an orphaned world down from the outside: invalidate its WXT contexts, then remove every
// listener it still has on document and window, so it can't answer the page's cross-world messages
// alongside the fresh copy. DOMDebugger reports only the listeners whose handler lives in the
// queried object's own world, so the page's and the fresh copy's listeners are never touched.
async function neutralizeWorld({ session, contextId }: {
  session: CdpSession;
  contextId: number;
}) {
  for (const expression of ["document", "window"]) {
    const { result: { objectId } } = await session.send<{ result: RemoteObject }>("Runtime.evaluate", {
      expression,
      contextId,
      objectGroup: OBJECT_GROUP
    });
    if (!objectId) {
      continue;
    }

    await invalidateWxtContexts({
      session,
      objectId
    });
    await removeWorldListeners({
      session,
      objectId
    });
  }
}

async function neutralizeOrphanedWorldsInPage({ page, worldName }: {
  page: CdpTarget;
  worldName: string;
}) {
  const session = await openCdpSession(page.webSocketDebuggerUrl!);
  try {
    const contexts: ExecutionContext[] = [];
    session.on("Runtime.executionContextCreated", rawMessage => {
      const { params }: { params: { context: ExecutionContext } } = JSON.parse(rawMessage);
      contexts.push(params.context);
    });
    await session.send("Runtime.enable");

    const extensionWorlds = contexts.filter(context =>
      context.auxData?.type === ISOLATED_WORLD_TYPE && context.name === worldName);
    for (const context of extensionWorlds) {
      const { result: probe } = await session.send<{ result: { value?: boolean } }>("Runtime.evaluate", {
        expression: ORPHANED_WORLD_PROBE,
        contextId: context.id,
        returnByValue: true
      });
      if (!probe.value) {
        continue;
      }

      await neutralizeWorld({
        session,
        contextId: context.id
      });
    }
  } finally {
    session.close();
  }
}

export function createChromeReloadTarget({ cdpPort, extensionName, reloadExtensionOverPipe }: ChromeReloadTargetOptions) {
  let extensionId: string | undefined;

  // The dev profile may carry other extensions whose worker is also background.js, so the first match
  // is by manifest name; after that, by id
  async function isOwnServiceWorker(target: CdpTarget) {
    if (extensionId) {
      return extensionIdOf(target) === extensionId;
    }

    const name = await evaluateOnTarget<string>(target.webSocketDebuggerUrl!, "chrome.runtime.getManifest().name")
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
      patterns.some(pattern => matchesUrlPattern(target.url ?? "", pattern)));
    await Promise.all(pages.map(page => neutralizeOrphanedWorldsInPage({
      page,
      worldName: extensionName
    }).catch((error: unknown) => {
      console.warn(`Could not neutralize the orphaned content scripts in ${page.url}: ${String(error)}`);
    })));
  }

  async function reloadExtension(plan: ExtensionReloadPlan) {
    const staleServiceWorker = (await listTargets(cdpPort)).find(target =>
      isExtensionServiceWorker(target) && extensionIdOf(target) === extensionId);
    await reloadExtensionOverPipe();
    const serviceWorker = await findServiceWorker(staleServiceWorker?.id);
    await neutralizeOrphanedContentScripts(plan);
    const result = await evaluateOnTarget<TabUpdateResult>(serviceWorker.webSocketDebuggerUrl!, buildTabUpdateSource(plan));
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
        name: basename(new URL(target.url ?? "").pathname, HTML_EXTENSION)
      }))
      .filter(({ target, name }) =>
        new URL(target.url ?? "").pathname.endsWith(HTML_EXTENSION) &&
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

    const session = await openCdpSession(target.webSocketDebuggerUrl!);
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

  const target: ReloadTarget = {
    reloadExtension,
    refreshPages
  };
  return {
    ...target,
    // Resolves the extension id up front, while the freshly installed worker is still awake
    discoverExtension: async () => extensionIdOf(await findServiceWorker())
  };
}
