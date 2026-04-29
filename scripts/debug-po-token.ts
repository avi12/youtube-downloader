/**
 * Triggers a download and checks what poToken ends up in the background.
 * Patches StartBackgroundDownload handler to log the token.
 */
import { fetchTargets, attachCdpMonitor } from "./cdp-utils.js";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const EVAL_TIMEOUT_MS = 15_000;

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
        returnByValue: true,
        awaitPromise: true
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
if (!subPage?.webSocketDebuggerUrl || !serviceWorker?.webSocketDebuggerUrl) {
  console.error("Missing targets"); process.exit(1);
}

// Attach SW monitor to see all log output
attachCdpMonitor(serviceWorker.webSocketDebuggerUrl, "SW", true);

// Patch SW to intercept StartBackgroundDownload and log poToken
await cdpEval(
  serviceWorker.webSocketDebuggerUrl, `
  // Monkeypatch console.warn to capture SABR error lines
  (function() {
    const origWarn = console.warn;
    console.warn = function(...args) {
      origWarn.apply(console, args);
    };
  })()
`
);

await wait(300);

// Trigger download
const gridJson = await cdpEval(
  subPage.webSocketDebuggerUrl, `
  (() => {
    const items = [...document.querySelectorAll('[data-ytdl-grid-item]')];
    const item = items[0];
    const btn = item?.querySelector('yt-button-view-model button');
    btn?.click();
    return JSON.stringify({ videoId: item?.dataset?.ytdlGridItem });
  })()
`
);
const { videoId } = JSON.parse(gridJson);
console.log("Clicked download for", videoId, "- monitoring for 30s...\n");

await wait(30_000);

// After download attempt, check if SABR capture has data for the tab with poToken
const captureCheck = await cdpEval(
  serviceWorker.webSocketDebuggerUrl, `
  (async () => {
    // Get all tabs
    const tabs = await browser.tabs.query({ url: '*://www.youtube.com/*' });
    const dl = await browser.downloads.search({ orderBy: ['-startTime'], limit: 1 });
    return JSON.stringify({
      tabCount: tabs.length,
      lastDownload: dl[0] ? { state: dl[0].state, file: dl[0].filename?.slice(-40) } : null
    });
  })()
`
);
console.log("Post-download check:", captureCheck);
process.exit(0);
