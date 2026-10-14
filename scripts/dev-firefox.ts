/**
 * Firefox side of the dev server's hot reload, over RDP (the Firefox DevTools Remote Debugging
 * Protocol): Firefox's CDP endpoint lists no targets, so everything runs in the extension's own
 * background event page, where the tabs/scripting APIs live. Adapted from youtube-time-manager's
 * scripts/dev-hmr-firefox.ts.
 *
 * A reloaded add-on's old content-script sandboxes are destroyed without running any cleanup, so
 * before the reload the live ISOLATED scripts are told to tear down (their WXT context invalidates,
 * unmounting their UI); afterwards the fresh copies are injected in place.
 */

import type { ContentScriptEntry } from "./dev-output-changes.ts";
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
import { spawnSync } from "node:child_process";
import { connect } from "node:net";
import { platform } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const RDP_CONNECT_TIMEOUT_MS = 12_000;
const RDP_REPLY_TIMEOUT_MS = 9000;
// A suspended event page never surfaces its real frame, only a devtools fallback page - so wait
// briefly to see whether it is already awake, longer once it has been woken
const AWAKE_BACKGROUND_WAIT_MS = 2500;
const WOKEN_BACKGROUND_WAIT_MS = 9000;
const BACKGROUND_RETRY_ATTEMPTS = 5;
const BACKGROUND_RETRY_DELAY_MS = 1000;
const EXTENSION_API_SOURCE = "(globalThis.browser ?? globalThis.chrome)";
const START_DEBUGGER_SERVER_FLAG = "-start-debugger-server";
const RDP_LENGTH_SEPARATOR = ":";
// The page Firefox wraps an MV3 background.scripts list in - other extension frames (the offscreen
// iframe) surface on the same watcher
const GENERATED_BACKGROUND_PAGE = "_generated_background_page.html";

type RdpPacket = {
  from?: string;
  type?: string;
  target?: {
    url?: string;
    consoleActor?: string;
  };
  processDescriptor?: { actor?: string };
  process?: { consoleActor?: string };
  frame?: { consoleActor?: string };
  addons?: {
    id: string;
    actor: string;
    manifestURL: string;
  }[];
  actor?: string;
  result?: unknown;
  exceptionMessage?: string;
};

type RdpWaiter = {
  predicate: (packet: RdpPacket) => boolean;
  fulfill: (packet: RdpPacket) => void;
  reject: (error: Error) => void;
};

type RdpClient = ReturnType<typeof createRdpClient>;

// web-ext picks the -start-debugger-server port per launch; read it off the dev Firefox's command
// line (the process running this dev server's profile). Stable for the session, so cached.
let cachedRdpPort: number | undefined;

function readFirefoxCommandLines(profileDir: string) {
  if (platform() === "win32") {
    const profileLiteral = profileDir.replace(/'/g, "''");
    const script = `Get-CimInstance Win32_Process -Filter "name='firefox.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${profileLiteral}') } | Select-Object -ExpandProperty CommandLine`;
    const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      input: script,
      encoding: "utf-8",
      timeout: 10_000
    });
    return (result.stdout ?? "").split(/\r?\n/);
  }

  const result = spawnSync("ps", ["-eo", "args"], {
    encoding: "utf-8",
    timeout: 10_000
  });
  return (result.stdout ?? "").split("\n").filter(line => line.includes(profileDir));
}

function parseRdpPort(commandLine: string) {
  const [, portText = ""] = commandLine.split(`${START_DEBUGGER_SERVER_FLAG} `);
  return parseInt(portText, 10);
}

function findFirefoxRdpPort(profileDir: string) {
  cachedRdpPort ??= readFirefoxCommandLines(profileDir).map(parseRdpPort).find(port => !Number.isNaN(port));
  return cachedRdpPort;
}

// Splits complete `<byteLength>:<json>` frames off the front of the buffer, keeping a partial tail
function splitRdpFrames(buffer: Buffer) {
  const frames: string[] = [];
  let rest = buffer;
  while (rest.includes(RDP_LENGTH_SEPARATOR)) {
    const separatorIndex = rest.indexOf(RDP_LENGTH_SEPARATOR);
    const frameEnd = separatorIndex + 1 + Number(rest.subarray(0, separatorIndex).toString("ascii"));
    if (Number.isNaN(frameEnd)) {
      rest = rest.subarray(separatorIndex + 1);
      continue;
    }

    if (rest.length < frameEnd) {
      break;
    }

    frames.push(rest.subarray(separatorIndex + 1, frameEnd).toString("utf8"));
    rest = rest.subarray(frameEnd);
  }
  return {
    frames,
    rest
  };
}

// A minimal RDP client over the `<byteLength>:<json>` framed socket
function createRdpClient(port: number) {
  const socket = connect(port, "127.0.0.1");
  let buffer: Buffer = Buffer.alloc(0);
  const waiters: RdpWaiter[] = [];
  let closeError: Error | undefined;

  function rejectWaiters(error: Error) {
    if (closeError) {
      return;
    }

    closeError = error;
    for (const waiter of waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  function deliverPacket(frame: string) {
    try {
      const packet: RdpPacket = JSON.parse(frame);
      const iWaiter = waiters.findIndex(waiter => waiter.predicate(packet));
      if (iWaiter >= 0) {
        waiters.splice(iWaiter, 1)[0].fulfill(packet);
      }
    } catch { /* not a JSON frame */ }
  }

  socket.on("data", chunk => {
    const { frames, rest } = splitRdpFrames(Buffer.concat([buffer, Buffer.from(chunk)]));
    buffer = rest;
    for (const frame of frames) {
      deliverPacket(frame);
    }
  });
  socket.on("error", error => rejectWaiters(error));
  socket.on("close", () => rejectWaiters(new Error("RDP socket closed")));

  function send(message: Record<string, unknown>) {
    if (closeError) {
      return;
    }

    const bytes = Buffer.from(JSON.stringify(message), "utf8");
    socket.write(`${bytes.length}:`);
    socket.write(bytes);
  }

  function waitFor(predicate: (packet: RdpPacket) => boolean, timeoutMs = RDP_REPLY_TIMEOUT_MS) {
    return new Promise<RdpPacket>((resolve, reject) => {
      if (closeError) {
        reject(closeError);
        return;
      }

      const waiter: RdpWaiter = {
        predicate,
        fulfill(packet) {
          clearTimeout(timer);
          resolve(packet);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      };
      // Drop a timed-out waiter, or it would steal a later matching packet from the next waitFor
      const timer = setTimeout(() => {
        const iWaiter = waiters.indexOf(waiter);
        if (iWaiter >= 0) {
          waiters.splice(iWaiter, 1);
        }

        reject(new Error("RDP reply timed out"));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  // RDP has no request ids - a reply is recognized by actor and shape - so the waiter is registered
  // before the request goes out (Firefox can answer within the same event-loop turn)
  function request({ to, type, extra = {}, predicate = () => true }: {
    to: string;
    type: string;
    extra?: Record<string, unknown>;
    predicate?: (packet: RdpPacket) => boolean;
  }) {
    const response = waitFor(packet => packet.from === to && predicate(packet));
    send({
      to,
      type,
      ...extra
    });
    return response;
  }

  return {
    send,
    waitFor,
    request,
    close: () => socket.destroy()
  };
}

function consoleActorOf(targetReply: RdpPacket) {
  return (targetReply.process ?? targetReply.frame)?.consoleActor;
}

// The parent process's console evaluates privileged code
async function findParentProcessConsole(client: RdpClient) {
  const { processDescriptor } = await client.request({
    to: "root",
    type: "getProcess",
    extra: { id: 0 }
  });
  if (!processDescriptor?.actor) {
    return undefined;
  }

  return consoleActorOf(await client.request({
    to: processDescriptor.actor,
    type: "getTarget"
  }));
}

// Wake a suspended background event page without touching any tab: privileged main-process code
// (WebExtensionPolicy) can, and Firefox honours it because the dev server launches it with
// MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1
async function wakeExtensionBackground({ client, extensionId }: {
  client: RdpClient;
  extensionId: string;
}) {
  const consoleActor = await findParentProcessConsole(client);
  if (!consoleActor) {
    return;
  }

  await client.request({
    to: consoleActor,
    type: "evaluateJSAsync",
    extra: { text: `WebExtensionPolicy.getByID(${JSON.stringify(extensionId)})?.extension.wakeupBackground()` },
    predicate: packet => packet.type === "evaluationResult"
  }).catch(() => undefined);
}

function waitForBackgroundFrameConsole({ client, backgroundPageUrl, timeoutMs }: {
  client: RdpClient;
  backgroundPageUrl: string;
  timeoutMs: number;
}) {
  return client
    .waitFor(packet =>
      packet.type === "target-available-form" &&
      packet.target?.url === backgroundPageUrl, timeoutMs)
    .then(packet => packet.target?.consoleActor)
    .catch(() => undefined);
}

async function findAddonWatcher({ client, extensionId }: {
  client: RdpClient;
  extensionId: string;
}) {
  const { addons = [] } = await client.request({
    to: "root",
    type: "listAddons"
  });
  const addon = addons.find(entry => entry.id === extensionId);
  if (!addon) {
    return undefined;
  }

  const watcher = await client.request({
    to: addon.actor,
    type: "getWatcher",
    extra: { isServerTargetSwitchingEnabled: true }
  });
  return {
    watcherActor: watcher.actor,
    // URL.origin is "null" for moz-extension:, so resolve the page against the manifest URL instead
    backgroundPageUrl: new URL(GENERATED_BACKGROUND_PAGE, addon.manifestURL).href
  };
}

async function findBackgroundConsole({ client, extensionId }: {
  client: RdpClient;
  extensionId: string;
}) {
  const addonWatcher = await findAddonWatcher({
    client,
    extensionId
  });
  if (!addonWatcher?.watcherActor) {
    return undefined;
  }

  const { watcherActor, backgroundPageUrl } = addonWatcher;
  const awakeBackground = waitForBackgroundFrameConsole({
    client,
    backgroundPageUrl,
    timeoutMs: AWAKE_BACKGROUND_WAIT_MS
  });
  client.send({
    to: watcherActor,
    type: "watchTargets",
    targetType: "frame"
  });
  const awakeConsoleActor = await awakeBackground;
  if (awakeConsoleActor) {
    return awakeConsoleActor;
  }

  const wokenBackground = waitForBackgroundFrameConsole({
    client,
    backgroundPageUrl,
    timeoutMs: WOKEN_BACKGROUND_WAIT_MS
  });
  await wakeExtensionBackground({
    client,
    extensionId
  });
  return wokenBackground;
}

// `mapped.await` makes evaluateJSAsync await the returned promise, as the console does for
// top-level await input
async function evaluateJsonInConsole({ client, consoleActor, source }: {
  client: RdpClient;
  consoleActor: string;
  source: string;
}) {
  const { exceptionMessage, result } = await client.request({
    to: consoleActor,
    type: "evaluateJSAsync",
    extra: {
      text: `(async () => JSON.stringify(await ${source}))()`,
      mapped: { await: true }
    },
    predicate: packet => packet.type === "evaluationResult"
  });
  if (typeof result !== "string") {
    throw new Error(exceptionMessage ?? "the background returned no result");
  }

  return result;
}

// Evaluate a source string that resolves to a JSON-serializable value in the extension's background
async function evaluateInBackground<TValue>({ profileDir, extensionId, source }: {
  profileDir: string;
  extensionId: string;
  source: string;
}) {
  const port = findFirefoxRdpPort(profileDir);
  if (!port) {
    throw new Error("could not find the dev Firefox's RDP port");
  }

  const client = createRdpClient(port);
  try {
    await client.waitFor(packet => packet.from === "root", RDP_CONNECT_TIMEOUT_MS);
    const consoleActor = await findBackgroundConsole({
      client,
      extensionId
    });
    if (!consoleActor) {
      throw new Error("the extension's background page is not reachable");
    }

    const value: TValue = JSON.parse(await evaluateJsonInConsole({
      client,
      consoleActor,
      source
    }));
    return value;
  } finally {
    client.close();
  }
}

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
      return refreshedPages.map(({ name, isClosed }): RefreshedPage => ({
        name,
        action: isClosed ? PageAction.Closed : PageAction.Reloaded
      }));
    }
  };
  return target;
}
