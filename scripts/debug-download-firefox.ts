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
const BUTTON_WAIT_MAX_MS = 8_000;
const listenSeconds = parseInt(process.argv[2] ?? "90", 10) || 90;

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

  // Diagnostic: show what ytdl elements are present regardless
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
      return JSON.stringify({ url, totalEls, byClass: byClass?.tagName ?? null, byAttr: byAttr?.tagName ?? null, allYtdl: allYtdl || '(none)' });
    })()`
  );
  console.log(`[diag] ytdl elements: ${ytdlDiag}`);

  if (buttonPollMs >= BUTTON_WAIT_MAX_MS) {
    console.log("YTDL toolbar button never appeared — monitoring only.");
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

  if (buttonState === "Download") {
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
