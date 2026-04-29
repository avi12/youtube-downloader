/**
 * Monitors SW/offscreen logs while triggering a grid download retry.
 */
import { fetchTargets, attachCdpMonitor } from "./cdp-utils.js";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const EVAL_TIMEOUT_MS = 15_000;
const LISTEN_MS = 60_000;

async function cdpEval(wsUrl: string, expr: string): Promise<string> {
  const signal = AbortSignal.timeout(EVAL_TIMEOUT_MS);
  const ws = new WebSocket(wsUrl);
  await once(ws, "open", { signal });
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: expr,
        returnByValue: true
      }
    })
  );
  const [raw] = await once(ws, "message", { signal });
  ws.close();
  const msg = JSON.parse(String(raw));
  const val = msg.result?.result?.value;
  return typeof val === "string" ? val : JSON.stringify(val);
}

const targets = await fetchTargets(CDP_PORT);
const subPage = targets.find(target => target.type === "page" && target.url?.includes("subscriptions"));
const serviceWorker = targets.find(target => target.type === "service_worker" && target.url?.includes(CHROME_EXT_ID));
const offscreen = targets.find(target => target.url?.includes("offscreen.html"));
if (!subPage?.webSocketDebuggerUrl) {
  console.error("No subs page"); process.exit(1);
}

if (!serviceWorker?.webSocketDebuggerUrl) {
  console.error("No SW"); process.exit(1);
}

console.log("Attaching log monitors...");
attachCdpMonitor(serviceWorker.webSocketDebuggerUrl, "SW", true);

if (offscreen?.webSocketDebuggerUrl) {
  attachCdpMonitor(offscreen.webSocketDebuggerUrl, "offscreen", false);
}

await wait(500);

// Find first grid item (failed or not)
const gridJson = await cdpEval(
  subPage.webSocketDebuggerUrl, `
  (() => {
    const items = [...document.querySelectorAll('[data-ytdl-grid-item]')];
    const item = items[0];
    const btn = item?.querySelector('yt-button-view-model button');
    return JSON.stringify({ videoId: item?.dataset?.ytdlGridItem, label: btn?.getAttribute('aria-label')?.slice(0,80) });
  })()
`
);
const grid = JSON.parse(gridJson);
console.log("Target:", grid.videoId, "|", grid.label);

// Click (retry if failed)
await cdpEval(
  subPage.webSocketDebuggerUrl, `
  (() => {
    const item = document.querySelector('[data-ytdl-grid-item="${grid.videoId}"]');
    const btn = item?.querySelector('yt-button-view-model button');
    btn?.click();
    return 'clicked';
  })()
`
);
console.log("Clicked. Listening for", LISTEN_MS / 1000, "seconds...\n");

await wait(LISTEN_MS);
process.exit(0);
