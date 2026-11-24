/**
 * Evaluates code in the extension's background event page over RDP (rdp-client.ts), waking it
 * page-safely when suspended through the privileged parent process. Adapted from
 * youtube-time-manager's scripts/dev-hmr-firefox.ts.
 */

import {
  connectRdp,
  RdpActor,
  type RdpClient,
  type RdpPacket,
  RdpPacketType,
  RdpRequestType,
  RdpTargetType
} from "./rdp-client.ts";

// A suspended event page never surfaces its real frame, only a devtools fallback page - so wait
// briefly to see whether it is already awake, longer once it has been woken
const AWAKE_BACKGROUND_WAIT_MS = 2500;
const WOKEN_BACKGROUND_WAIT_MS = 9000;

// A string completion value, so the console reports a result for a script that returns nothing
const SCRIPT_COMPLETED = "completed";
// The page Firefox wraps an MV3 background.scripts list in - other extension frames (the offscreen
// iframe) surface on the same watcher
const GENERATED_BACKGROUND_PAGE = "_generated_background_page.html";

function consoleActorOf(targetReply: RdpPacket) {
  return (targetReply.process ?? targetReply.frame)?.consoleActor;
}

// The parent process's console evaluates privileged code
async function findParentProcessConsole(client: RdpClient) {
  const { processDescriptor } = await client.request({
    to: RdpActor.Root,
    type: RdpRequestType.GetProcess,
    extra: {
       id: 0 
    }
  });
  if (!processDescriptor?.actor) {
    return undefined;
  }

  return consoleActorOf(
           await client.request({
    to: processDescriptor.actor,
    type: RdpRequestType.GetTarget
  })
         );
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
    type: RdpRequestType.EvaluateJsAsync,
    extra: {
       text: `WebExtensionPolicy.getByID(${JSON.stringify(extensionId)})?.extension.wakeupBackground()` 
    },
    predicate: packet => packet.type === RdpPacketType.EvaluationResult
  }).catch(() => undefined);
}

function waitForBackgroundFrameConsole({ client, backgroundPageUrl, timeoutMs }: {
  client: RdpClient;
  backgroundPageUrl: string;
  timeoutMs: number;
}) {
  return client
    .waitFor({
      predicate: packet =>
      packet.type === RdpPacketType.TargetAvailableForm &&
      packet.target?.url === backgroundPageUrl,
      timeoutMs
    })
    .then(packet => packet.target?.consoleActor)
    .catch(() => undefined);
}

async function findAddonWatcher({ client, extensionId }: {
  client: RdpClient;
  extensionId: string;
}) {
  const { addons = [] } = await client.request({
    to: RdpActor.Root,
    type: RdpRequestType.ListAddons
  });
  const addon = addons.find(entry => entry.id === extensionId);
  if (!addon) {
    return undefined;
  }

  const watcher = await client.request({
    to: addon.actor,
    type: RdpRequestType.GetWatcher,
    extra: {
       isServerTargetSwitchingEnabled: true 
    }
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
    type: RdpRequestType.WatchTargets,
    targetType: RdpTargetType.Frame
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
// top-level await input; a whole script goes without it, so its `var`s land on the global
async function evaluateInConsole({ client, consoleActor, text, isAwaited }: {
  client: RdpClient;
  consoleActor: string;
  text: string;
  isAwaited: boolean;
}) {
  const { exceptionMessage, result } = await client.request({
    to: consoleActor,
    type: RdpRequestType.EvaluateJsAsync,
    extra: {
      text,
      ...isAwaited ? {
         mapped: {
         await: true 
      } 
      } : {}
    },
    predicate: packet => packet.type === RdpPacketType.EvaluationResult
  });
  if (typeof result !== "string") {
    throw new Error(exceptionMessage ?? "the background returned no result");
  }

  return result;
}

interface BackgroundEvaluation {
  profileDir: string;
  extensionId: string;
  text: string;
  isAwaited: boolean;
}

// Evaluate text in the extension's background page, resolving to its string result
async function evaluateTextInBackground({ profileDir, extensionId, text, isAwaited }: BackgroundEvaluation) {
  const client = await connectRdp(profileDir);
  try {
    const consoleActor = await findBackgroundConsole({
      client,
      extensionId
    });
    if (!consoleActor) {
      throw new Error("the extension's background page is not reachable");
    }

    return await evaluateInConsole({
      client,
      consoleActor,
      text,
      isAwaited
    });
  } finally {
    client.close();
  }
}

// Evaluate a source string that resolves to a JSON-serializable value in the extension's background
export async function evaluateInBackground<TValue>({ profileDir, extensionId, source }: Omit<BackgroundEvaluation, "text" | "isAwaited"> & { source: string }) {
  const value: TValue = JSON.parse(
    await evaluateTextInBackground({
      profileDir,
      extensionId,
      text: `(async () => JSON.stringify(await ${source}))()`,
      isAwaited: true
    })
  );
  return value;
}

// Run a whole classic script in the background page's global scope
export async function runScriptInBackground({ profileDir, extensionId, script }: Omit<BackgroundEvaluation, "text" | "isAwaited"> & { script: string }) {
  await evaluateTextInBackground({
    profileDir,
    extensionId,
    text: `${script}\n;${JSON.stringify(SCRIPT_COMPLETED)}`,
    isAwaited: false
  });
}

// The add-on's moz-extension:// host - a per-profile UUID, unlike the gecko id
export async function findAddonUuid({ profileDir, extensionId }: { profileDir: string; extensionId: string }) {
  const client = await connectRdp(profileDir);
  try {
    const { addons = [] } = await client.request({
      to: RdpActor.Root,
      type: RdpRequestType.ListAddons
    });
    const manifestUrl = addons.find(entry => entry.id === extensionId)?.manifestURL;
    return manifestUrl ? new URL(manifestUrl).host : undefined;
  } finally {
    client.close();
  }
}
