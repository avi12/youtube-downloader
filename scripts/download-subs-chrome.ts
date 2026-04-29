/**
 * Triggers a grid download from the subscriptions page on the dev server Chrome
 * and polls until complete or timeout.
 */
import { fetchTargets } from "./cdp-utils.js";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const EVAL_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 36; // 3 minutes

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
  if (msg.result?.exceptionDetails) {
    throw new Error(msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text);
  }

  const val = msg.result?.result?.value;
  return typeof val === "string" ? val : JSON.stringify(val);
}

const targets = await fetchTargets(CDP_PORT);
const subPage = targets.find(target => target.type === "page" && target.url?.includes("subscriptions"));
if (!subPage?.webSocketDebuggerUrl) {
  console.error("No subscriptions page found on CDP port", CDP_PORT);
  process.exit(1);
}

console.log("Found subscriptions page:", subPage.url);

// Find first downloadable grid item
const gridJson = await cdpEval(
  subPage.webSocketDebuggerUrl, `
  (() => {
    const items = [...document.querySelectorAll('[data-ytdl-grid-item]')];
    const item = items.find(el => {
      const btn = el.querySelector('yt-button-view-model button');
      return btn && !btn.getAttribute('aria-label')?.startsWith('Cancel');
    });
    const btn = item?.querySelector('yt-button-view-model button');
    return JSON.stringify({ videoId: item?.dataset?.ytdlGridItem, label: btn?.getAttribute('aria-label')?.slice(0,80) });
  })()
`
);
const grid = JSON.parse(gridJson);
console.log("First downloadable:", grid.videoId, "|", grid.label);

if (!grid.videoId) {
  console.error("No downloadable grid item found");
  process.exit(1);
}

// Click the download button
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
console.log("Clicked download for", grid.videoId);

// Poll progress
for (let i = 0; i < MAX_POLLS; i++) {
  await wait(POLL_INTERVAL_MS);
  const stateJson = await cdpEval(
    subPage.webSocketDebuggerUrl, `
    (() => {
      const item = document.querySelector('[data-ytdl-grid-item="${grid.videoId}"]');
      const btn = item?.querySelector('yt-button-view-model button');
      const progress = item?.parentElement?.querySelector('[data-ytdl-progress]')
        ?.querySelector('tp-yt-paper-progress');
      return JSON.stringify({
        label: btn?.getAttribute('aria-label')?.slice(0, 80),
        progress: progress?.getAttribute('value')
      });
    })()
  `
  );
  const state = JSON.parse(stateJson);
  const elapsed = (i + 1) * (POLL_INTERVAL_MS / 1000);
  console.log(`T+${elapsed}s: label="${state.label}" progress=${state.progress ?? "n/a"}`);

  if (state.label?.toLowerCase().includes("downloaded") || state.label?.toLowerCase().includes("open")) {
    console.log("SUCCESS: Download completed on Chrome!");
    process.exit(0);
  }
}

console.log("Timed out - check browser manually.");
process.exit(1);
