/**
 * Triggers a watch-page download in Firefox and streams all extension +
 * YouTube-tab console messages via the Firefox Remote Debugging Protocol.
 *
 * Flow:
 *  1. Discover the dynamic RDP port (exclude 2828 / 9230).
 *  2. Subscribe to the extension background + every YouTube tab via RDP.
 *  3. Find the watch-page tab, get its consoleActor, and click the
 *     Download button via evaluateJS.
 *  4. Stream logs for LISTEN_SECONDS, then exit.
 *
 * Usage (from repo root):
 *   npx tsx scripts/debug-download-firefox.ts [listenSeconds]
 *
 * Requires dev-server started with --firefox.
 */
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const SUBSCRIBE_SETTLE_MS = 500;
// YTDL button injection is async (polls for the actions container). Wait up to
// this long for the .ytdl-download-button element to appear before giving up on auto-click.
const BUTTON_WAIT_POLL_MS = 500;
const BUTTON_WAIT_MAX_MS = 20_000;
const NAV_SETTLE_MS = 12_000;
const monitorIdx = process.argv.indexOf("--monitor");
const listenSeconds =
  monitorIdx >= 0
    ? parseInt(process.argv[monitorIdx + 1] ?? "90", 10) || 90
    : parseInt(process.argv[2] ?? "90", 10) || 90;
const shouldNavigate = process.argv.includes("--navigate");
const statusOnly = process.argv.includes("--status-only");

// ── Helpers ──────────────────────────────────────────────────────────────────

function subscribeWatcher(rdp: RDP, watcherActor: string) {
  rdp.send(watcherActor, "watchTargets", { targetType: "frame" });
  rdp.send(watcherActor, "watchResources", { resourceTypes: ["console-message"] });
}

async function attachConsoleActor(rdp: RDP, consoleActor: string) {
  // Classic Firefox RDP: startListeners on the webconsole actor to receive
  // consoleAPICall events. The newer watchResources approach doesn't reliably
  // deliver events over the raw TCP socket.
  await rdp.request(consoleActor, "startListeners", {
    listeners: ["ConsoleAPI", "LogMessage", "PageError"]
  });
}

function formatArgs(args: (string | Record<string, unknown>)[] = []): string {
  return args.map(arg => {
    if (typeof arg === "string") {
      return arg;
    }

    if (!isRecord(arg)) {
      return JSON.stringify(arg);
    }

    if (arg.type === "object") {
      const className = typeof arg.class === "string" ? arg.class : "Object";
      const preview = arg.preview;
      if (isRecord(preview)) {
        // Error grips: preview.message is the error message
        if (typeof preview.message === "string" && preview.message) {
          return `[${className}: ${preview.message}]`;
        }

        // Fallback: look in ownProperties for message field
        const props = Array.isArray(preview.ownProperties) ? preview.ownProperties : [];
        const msgProp = props.find(
          (prop): prop is Record<string, unknown> => isRecord(prop) && prop.name === "message"
        );
        if (isRecord(msgProp) && typeof msgProp.value === "string" && msgProp.value) {
          return `[${className}: ${msgProp.value}]`;
        }
      }

      return `[${className}]`;
    }

    if (arg.type === "string") {
      return String(arg.value ?? "");
    }

    if (arg.type === "undefined") {
      return "undefined";
    }

    if (arg.type === "null") {
      return "null";
    }

    if ("value" in arg) {
      return String(arg.value);
    }

    return JSON.stringify(arg);
  }).join(" ");
}

// ── Main ─────────────────────────────────────────────────────────────────────

// 1. Connect to RDP
const rdpPort = findFirefoxRdpPort();
if (!rdpPort) {
  console.error("Could not find Firefox RDP port. Is the dev server running with --firefox?");
  process.exit(1);
}

console.log(`Connecting to Firefox RDP on port ${rdpPort}...`);
const rdp = new RDP(rdpPort);
try {
  await rdp.connect();
} catch (error) {
  console.error(`RDP connect failed: ${error instanceof Error ? error.message : error}`);
  console.error("Is the dev server running with --firefox?");
  process.exit(1);
}

// 2. Wire up log streaming before subscribing
let messageCount = 0;
const seenPacketTypes = new Set<string>();

function handleConsoleMessageResources(resourcesArray: unknown[]) {
  for (const item of resourcesArray) {
    if (!Array.isArray(item) || item.length < 2) {
      continue;
    }

    const [resourceType, rawMessages] = item;
    if (resourceType !== "console-message" || !Array.isArray(rawMessages)) {
      continue;
    }

    for (const rawMessage of rawMessages) {
      if (!isRecord(rawMessage)) {
        continue;
      }

      const level = typeof rawMessage.level === "string" ? rawMessage.level : "log";
      const rawArgs = Array.isArray(rawMessage.arguments) ? rawMessage.arguments.filter(
        (arg): arg is string | Record<string, unknown> => typeof arg === "string" || isRecord(arg)
      ) : [];
      const text = formatArgs(rawArgs);
      if (!text.trim()) {
        continue;
      }

      const timestamp = typeof rawMessage.timeStamp === "number" ? rawMessage.timeStamp : Date.now();
      const time = new Date(timestamp).toISOString().slice(11, 23);
      console.log(`[${time}][${level.toUpperCase()}] ${text}`);
      messageCount++;
    }
  }
}

rdp.onEvent = (packet: Record<string, unknown>) => {
  const packetType = String(packet.type ?? "(none)");

  // Log each new packet type once so we can see what the RDP server is sending
  if (!seenPacketTypes.has(packetType)) {
    seenPacketTypes.add(packetType);
    const keys = Object.keys(packet).join(", ");
    // For unknown types, dump a snippet of the packet to help diagnose
    const snippet = ["resources-available-array", "resource-available-form", "evaluationResult", "frameUpdate"].includes(packetType)
      ? "" : ` sample=${JSON.stringify(packet).slice(0, 200)}`;
    console.log(`[rdp] new packet type="${packetType}" keys=[${keys}]${snippet}`);
  }

  // Classic Firefox RDP: consoleAPICall from webconsole startListeners
  if (packetType === "consoleAPICall") {
    const msg = isRecord(packet.message) ? packet.message : packet;
    const level = typeof msg.level === "string" ? msg.level : "log";
    const rawArgs = Array.isArray(msg.arguments) ? msg.arguments.filter(
      (arg): arg is string | Record<string, unknown> => typeof arg === "string" || isRecord(arg)
    ) : [];
    const text = formatArgs(rawArgs);
    if (text.trim()) {
      const timestamp = typeof msg.timeStamp === "number" ? msg.timeStamp : Date.now();
      const time = new Date(timestamp).toISOString().slice(11, 23);
      console.log(`[${time}][${level.toUpperCase()}] ${text}`);
      messageCount++;
    }

    return;
  }

  // Classic Firefox RDP: pageError from webconsole startListeners
  if (packetType === "pageError") {
    const err = isRecord(packet.pageError) ? packet.pageError : packet;
    const level = typeof err.errorMessage === "string" ? "error" : "warn";
    const text = typeof err.errorMessage === "string" ? err.errorMessage : JSON.stringify(err).slice(0, 200);
    if (text.trim()) {
      const time = new Date(Date.now()).toISOString().slice(11, 23);
      console.log(`[${time}][${level.toUpperCase()}] ${text}`);
      messageCount++;
    }

    return;
  }

  if (packetType === "resources-available-array") {
    // Firefox RDP uses "resources" field; older builds used "array"
    const resourcesArray = Array.isArray(packet.resources) ? packet.resources
      : Array.isArray(packet.array) ? packet.array
      : null;
    if (!resourcesArray) {
      console.error(`[rdp] resources-available-array has no resources/array: keys=[${Object.keys(packet).join(", ")}]`);
      return;
    }

    handleConsoleMessageResources(resourcesArray);
    return;
  }

  // Firefox newer protocol: "resource-available-form" (singular, not array)
  if (packetType === "resource-available-form") {
    const resources = Array.isArray(packet.resources) ? packet.resources : [];
    for (const res of resources) {
      if (!isRecord(res) || res.resourceType !== "console-message") {
        continue;
      }

      const level = typeof res.level === "string" ? res.level : "log";
      const rawArgs = Array.isArray(res.arguments) ? res.arguments.filter(
        (arg): arg is string | Record<string, unknown> => typeof arg === "string" || isRecord(arg)
      ) : [];
      const text = formatArgs(rawArgs);
      if (!text.trim()) {
        continue;
      }

      const timestamp = typeof res.timeStamp === "number" ? res.timeStamp : Date.now();
      const time = new Date(timestamp).toISOString().slice(11, 23);
      console.log(`[${time}][${level.toUpperCase()}] ${text}`);
      messageCount++;
    }
  }
};

// 3. Subscribe to YouTube tabs + find the watch tab's consoleActor
// (Extension background watcher is skipped — getWatcher on addon actor hangs in Firefox MV3.
// BG debug logs are forwarded to YouTube tabs via broadcastDebugLogToYouTubeTabs anyway.)
const tabsResponse = await rdp.request("root", "listTabs");
const youtubeTabs = (Array.isArray(tabsResponse.tabs) ? tabsResponse.tabs : [])
  .filter(isFirefoxTab)
  .filter(tab => tab.url?.includes("youtube.com"));

let watchConsoleActor: string | null = null;

for (const tab of youtubeTabs) {
  const tabWatcher = await rdp.request(tab.actor, "getWatcher", {
    isServerTargetSwitchingEnabled: false
  });
  if (typeof tabWatcher.actor === "string") {
    subscribeWatcher(rdp, tabWatcher.actor);
    console.log(`  Subscribed: tab ${tab.url?.slice(0, 70)}`);
  }

  // Collect consoleActor + attach startListeners for ALL youtube tabs
  const targetResp = await rdp.request(tab.actor, "getTarget");
  const frame = targetResp.frame;
  if (isRecord(frame) && typeof frame.consoleActor === "string") {
    const consoleActor = frame.consoleActor;
    await attachConsoleActor(rdp, consoleActor);
    console.log(`  Console attached: ${tab.url?.slice(0, 70)}`);
    if (tab.url?.includes("youtube.com/watch") && !watchConsoleActor) {
      watchConsoleActor = consoleActor;
    }
  }
}

await wait(SUBSCRIBE_SETTLE_MS);

// 4. If --navigate: reload the watch tab so fresh content scripts are injected,
//    then re-discover the console actor for the newly-loaded page.
const watchTab = (Array.isArray(tabsResponse.tabs) ? tabsResponse.tabs : [])
  .filter(isFirefoxTab)
  .find(tab => tab.url?.includes("youtube.com/watch"));

if (shouldNavigate && watchConsoleActor && watchTab) {
  console.log(`\nNavigating watch tab to reload content scripts...`);
  // Trigger reload via existing console actor (will be invalid after nav)
  try {
    await rdp.evalInTab(watchConsoleActor, `location.reload()`);
  } catch { /* expected - page navigates away */ }
  console.log(`Waiting ${NAV_SETTLE_MS / 1000}s for page to load...`);
  await wait(NAV_SETTLE_MS);
  // Focus the tab so YouTube's player initializes (background tabs throttle Polymer)
  try {
    await rdp.request(watchTab.actor, "focus");
    console.log(`Focused watch tab`);
  } catch { /* not all Firefox versions support this */ }
  // Re-attach to the new console actor for the reloaded page
  const newTarget = await rdp.request(watchTab.actor, "getTarget");
  const newFrame = newTarget.frame;
  if (isRecord(newFrame) && typeof newFrame.consoleActor === "string") {
    watchConsoleActor = newFrame.consoleActor;
    await attachConsoleActor(rdp, watchConsoleActor);
    console.log(`Re-attached console actor after navigation`);
    // Give window.focus() call in page context another chance
    try {
      await rdp.evalInTab(watchConsoleActor, `window.focus()`);
    } catch { /* best effort */ }
  }
}

// 5. Click the download button via consoleActor evaluateJS
if (!watchConsoleActor) {
  console.log("\nNo watch page found — monitoring only.");
} else {
  // Emit a test console.log to verify the subscription is working
  await rdp.evalInTab(watchConsoleActor, `console.log('[ytdl-rdp-test] subscription check')`);
  await wait(300);
  // Poll until the YTDL toolbar button appears (injection is async).
  console.log("\nWaiting for YTDL toolbar button...");
  let buttonPollMs = 0;
  while (buttonPollMs < BUTTON_WAIT_MAX_MS) {
    const found = await rdp.evalInTab(watchConsoleActor,
      `!!document.querySelector('.ytdl-download-button')`
    );
    if (found === "true") break;
    await wait(BUTTON_WAIT_POLL_MS);
    buttonPollMs += BUTTON_WAIT_POLL_MS;
  }

  // Diagnostic: show what ytdl elements and page state are present regardless
  const ytdlDiag = await rdp.evalInTab(watchConsoleActor,
    `(() => {
      const byClass = document.querySelector('.ytdl-download-button');
      // getAttribute('class') works for all elements including SVG; className may be SVGAnimatedString
      const byAttr = [...document.querySelectorAll('[class]')].find(el => (el.getAttribute('class') ?? '').includes('ytdl-download-button'));
      const allYtdl = [...document.querySelectorAll('[class*="ytdl"]')].map(el => {
        const cls = (el.getAttribute('class') ?? '').split(' ').filter(c => c.startsWith('ytdl')).join('.');
        return el.tagName + (cls ? '.' + cls : '');
      }).join(', ');
      const url = location.href.slice(0, 80);
      const totalEls = document.querySelectorAll('*').length;
      const hasActionsContainer = !!document.querySelector('#top-level-buttons-computed');
      const playerDataVideoId = document.querySelector('ytd-watch-flexy')?.playerData?.videoDetails?.videoId ?? null;
      const initialResponseVideoId = window.ytInitialPlayerResponse?.videoDetails?.videoId ?? null;
      return JSON.stringify({ url, totalEls, byClass: byClass?.tagName ?? null, byAttr: byAttr?.tagName ?? null, allYtdl: allYtdl || '(none)', hasActionsContainer, playerDataVideoId, initialResponseVideoId });
    })()`
  );
  console.log(`[diag] ytdl elements: ${ytdlDiag}`);

  // If button never appeared, wait for #top-level-buttons-computed to exist (may be
  // delayed by Polymer hydration or be inside shadow DOM), then dispatch yt-navigate-finish.
  if (buttonPollMs >= BUTTON_WAIT_MAX_MS) {
    // Deep shadow-DOM search + DOM structure diagnostic
    const shadowSearch = `(() => {
      function deepQuery(root, sel) {
        const r = root.querySelector(sel); if (r) return true;
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot && deepQuery(el.shadowRoot, sel)) return true;
        }
        return false;
      }
      const hasShadow = deepQuery(document, '#top-level-buttons-computed');
      const ytdWatchShadow = deepQuery(document, 'ytd-watch-flexy');
      const ytdWatch = !!document.querySelector('ytd-watch-flexy');
      const ytdApp = !!document.querySelector('ytd-app');
      const readyState = document.readyState;
      const bodyChildren = [...document.body.children].map(el => el.tagName.toLowerCase()).slice(0, 10).join(', ');
      const ytdAppChildren = document.querySelector('ytd-app')?.shadowRoot
        ? [...document.querySelector('ytd-app').shadowRoot.children].map(el => el.tagName.toLowerCase()).slice(0, 10).join(', ')
        : 'no-shadow-root';
      return JSON.stringify({ hasShadow, ytdWatchShadow, ytdWatch, ytdApp, readyState, bodyChildren, ytdAppChildren });
    })()`;

    console.log("Button not found — waiting up to 60s for ytd-watch-flexy + #top-level-buttons-computed...");
    let containerWaitMs = 0;
    let containerFound = false;
    while (containerWaitMs < 60_000) {
      const shadowResult = await rdp.evalInTab(watchConsoleActor, shadowSearch);
      console.log(`[shadow-diag] ${shadowResult} (waited ${containerWaitMs}ms)`);
      const parsed: Record<string, unknown> = JSON.parse(shadowResult);
      if (parsed.hasShadow) {
        containerFound = true;
        break;
      }

      // Also check via direct eval in light DOM
      const lightCheck = await rdp.evalInTab(watchConsoleActor,
        `!!document.querySelector('#top-level-buttons-computed')`
      );
      if (lightCheck === "true") {
        containerFound = true;
        break;
      }

      await wait(2000);
      containerWaitMs += 2000;
    }

    if (containerFound) {
      console.log(`Container found after ${containerWaitMs}ms — polling for button...`);
    } else {
      // If ytd-watch-flexy exists, the natural yt-navigate-finish already fired — don't abort
      // its findVideoActionsContainer observer by dispatching again. Only dispatch if truly stuck.
      const latestDiag = await rdp.evalInTab(watchConsoleActor, shadowSearch);
      const latestParsed: Record<string, unknown> = JSON.parse(latestDiag);
      if (!latestParsed.ytdWatch) {
        console.log("ytd-watch-flexy never appeared — dispatching yt-navigate-finish...");
        await rdp.evalInTab(watchConsoleActor, `document.dispatchEvent(new Event('yt-navigate-finish'))`);
        await wait(6000);
      } else {
        console.log("ytd-watch-flexy exists, natural event already fired — just waiting for button...");
      }
    }

    let retryMs = 0;
    while (retryMs < 20_000) {
      const found = await rdp.evalInTab(watchConsoleActor, `!!document.querySelector('.ytdl-download-button')`);
      if (found === "true") {
        buttonPollMs = 0;
        break;
      }

      await wait(BUTTON_WAIT_POLL_MS);
      retryMs += BUTTON_WAIT_POLL_MS;
    }

    if (retryMs >= 20_000) {
      console.log("Button still not found — monitoring only.");
    }
  }
  console.log(`\nChecking download button state (waited ${buttonPollMs}ms)...`);
  // The YTDL toolbar download button has class ytdl-download-button (download segment).
  const buttonState = await rdp.evalInTab(
    watchConsoleActor,
    `(() => {
      const ytdlDEl = document.querySelector('.ytdl-download-button');
      if (!ytdlDEl) return 'ytdl-download-button not found';
      const innerBtn = ytdlDEl.querySelector('button');
      const progressRing = document.querySelector('.ytdl-watch-progress-ring');
      const ringOpacity = progressRing ? window.getComputedStyle(progressRing).opacity : '0';
      const isDownloading = parseFloat(ringOpacity) > 0.5;
      if (isDownloading) return 'Cancel';
      return innerBtn ? 'Download' : 'ytdl-download-button (no inner button)';
    })()`
  );
  console.log(`YTDL button state: ${buttonState}`);

  if (statusOnly) {
    console.log("--status-only: skipping click.");
  } else if (buttonState === "Download") {
    console.log("Clicking YTDL toolbar download button...");
    const clickResult = await rdp.evalInTab(
      watchConsoleActor,
      `(() => {
        const ytdlDEl = document.querySelector('.ytdl-download-button');
        if (!ytdlDEl) return 'ytdl-download-button not found';
        const innerBtn = ytdlDEl.querySelector('button');
        if (innerBtn) { innerBtn.click(); return 'clicked inner button'; }
        ytdlDEl.click();
        return 'clicked ytdl-download-button element';
      })()`
    );
    console.log(`Click result: ${clickResult}`);
  } else if (buttonState === "Cancel") {
    console.log("Download already in progress - monitoring...");
  } else {
    console.log("Unexpected state — skipping click.");
  }
}

console.log(`\nStreaming logs for ${listenSeconds}s...\n`);
await wait(listenSeconds * 1000);

console.log(`\nDone. ${messageCount} message(s) captured.`);
rdp.destroy();
