/**
 * Checks the current SABR credentials state in Chrome and tests what poToken is available.
 */
import { fetchTargets } from "./cdp-utils.js";
import { once } from "node:events";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const EVAL_TIMEOUT_MS = 10_000;

async function cdpEval(wsUrl: string, expr: string): Promise<unknown> {
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
if (!subPage?.webSocketDebuggerUrl) {
  console.error("No subs page"); process.exit(1);
}

if (!serviceWorker?.webSocketDebuggerUrl) {
  console.error("No SW"); process.exit(1);
}

// Check SW SABR capture state
const swState = await cdpEval(
  serviceWorker.webSocketDebuggerUrl, `
(async () => {
  // Check all storage
  const storage = await browser.storage.local.get();
  const session = await browser.storage.session?.get?.() ?? {};
  const dls = await browser.downloads.search({ orderBy: ["-startTime"], limit: 3 });
  return JSON.stringify({
    storageKeys: Object.keys(storage),
    sessionKeys: Object.keys(session),
    recentDownloads: dls.map(d => ({ id: d.id, state: d.state, filename: d.filename?.slice(-50) }))
  }, null, 2);
})()
`
);
console.log("SW State:", swState);

// Check page for sabrCredentials DOM element
const pageState = await cdpEval(
  subPage.webSocketDebuggerUrl, `
(() => {
  const el = document.getElementById('ytdl-sabr-credentials');
  const items = [...document.querySelectorAll('[data-ytdl-grid-item]')];
  const btn = items[0]?.querySelector('yt-button-view-model button');
  return JSON.stringify({
    hasSabrCredsDom: !!el,
    sabrUrl: el?.dataset?.url?.slice(0, 60),
    hasPoToken: !!el?.dataset?.poToken,
    poTokenLength: el?.dataset?.poToken?.length,
    firstItemId: items[0]?.dataset?.ytdlGridItem,
    firstBtnLabel: btn?.getAttribute('aria-label')?.slice(0, 80)
  }, null, 2);
})()
`
);
console.log("\nPage State:", pageState);

// Check SW captured SABR state directly via internal function
const sabrCapture = await cdpEval(
  serviceWorker.webSocketDebuggerUrl, `
(async () => {
  try {
    // Check if SABR capture has data
    const pages = await browser.tabs.query({ url: '*://www.youtube.com/*' });
    return JSON.stringify({ tabCount: pages.length, tabIds: pages.map(p => p.id) });
  } catch (e) {
    return 'ERR: ' + e.message;
  }
})()
`
);
console.log("\nSW Tab info:", sabrCapture);
