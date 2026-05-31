/**
 * verify-download.mjs
 *
 * Runs one full download cycle for the currently-open YouTube watch tab and
 * reports success/fail. Used between cherry-picks to confirm the extension
 * still actually downloads.
 *
 * Steps:
 *   1. Find the YT watch tab via CDP (port 9229 by default).
 *   2. Wait for the extension's "Download" button to be mounted, then click it.
 *   3. Open (or reuse) a separate chrome://downloads tab.
 *   4. Poll the downloads list for a NEW item that reaches state="COMPLETE".
 *   5. Print a JSON line with { ok, reason, filename, durationMs } and exit 0/1.
 *
 * Usage:
 *   node scripts/verify-download.mjs [port] [timeoutSec]
 *   defaults: port=9229, timeoutSec=300
 */

import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 9229);
const TIMEOUT_MS = Number(process.argv[3] ?? 300) * 1000;
const WATCH_URL_PART = "youtube.com/watch";
const DOWNLOADS_URL = "chrome://downloads/";

const cdpId = (() => { let n = 0; return () => ++n; })();

function cdpSend(socket, method, params = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const id = cdpId();
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMsg);
      reject(new Error(`cdpSend timeout: ${method}`));
    }, timeoutMs);
    const onMsg = e => {
      const data = JSON.parse(String(e.data));
      if (data.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMsg);
      if (data.error) reject(new Error(`${method}: ${data.error.message}`));
      else resolve(data.result);
    };
    socket.addEventListener("message", onMsg);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function openSocketOnce(wsUrl) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(wsUrl);
    s.onopen = () => resolve(s);
    s.onerror = e => reject(new Error(`ws open failed: ${e.message ?? e}`));
  });
}

async function openSocket(wsUrl, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await openSocketOnce(wsUrl);
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  throw lastErr;
}

async function fetchTargets() {
  const res = await fetch(`http://localhost:${PORT}/json`);
  return res.json();
}

async function evalOn(target, expression) {
  const socket = await openSocket(target.webSocketDebuggerUrl);
  try {
    const r = await cdpSend(socket, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`runtime ex: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  } finally {
    socket.close();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findWatchTab() {
  const targets = await fetchTargets();
  return targets.find(t => t.type === "page" && (t.url ?? "").includes(WATCH_URL_PART));
}

async function findServiceWorker() {
  const targets = await fetchTargets();
  return targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
}

async function searchDownloads() {
  return safeEvalOnFreshSw(`
    new Promise(res => {
      chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] }, items => {
        res(items.map(it => ({
          id: it.id, filename: it.filename, state: it.state,
          startTime: it.startTime, endTime: it.endTime,
          bytesReceived: it.bytesReceived, totalBytes: it.totalBytes,
          error: it.error
        })));
      });
    })
  `);
}

async function snapshotDownloadIds() {
  const items = await searchDownloads();
  return new Set((items ?? []).map(it => it.id));
}

async function pollForNewCompletion(beforeIds, deadline) {
  while (Date.now() < deadline) {
    const items = await searchDownloads();
    const fresh = (items ?? []).filter(it => !beforeIds.has(it.id));
    for (const it of fresh) {
      if (it.state === "complete") return { ok: true, item: it };
      if (it.state === "interrupted") return { ok: false, reason: `download interrupted: ${it.error ?? "?"}`, item: it };
    }
    await sleep(500);
  }
  const final = await searchDownloads();
  const fresh = (final ?? []).filter(it => !beforeIds.has(it.id));
  for (const it of fresh) {
    if (it.state === "complete") return { ok: true, item: it };
  }
  return { ok: false, reason: "timeout waiting for new download to complete" };
}

async function freshWatchTab() {
  for (let i = 0; i < 10; i++) {
    const t = await findWatchTab();
    if (t) return t;
    await sleep(1000);
  }
  return null;
}

async function freshSw() {
  for (let i = 0; i < 10; i++) {
    const t = await findServiceWorker();
    if (t) return t;
    await sleep(1000);
  }
  return null;
}

async function safeEvalOnFreshWatchTab(expression) {
  for (let i = 0; i < 4; i++) {
    try {
      const tab = await freshWatchTab();
      if (!tab) return null;
      return await evalOn(tab, expression);
    } catch (e) {
      await sleep(1500);
    }
  }
  return null;
}

async function safeEvalOnFreshSw(expression) {
  for (let i = 0; i < 4; i++) {
    try {
      const sw = await freshSw();
      if (!sw) return null;
      return await evalOn(sw, expression);
    } catch (e) {
      await sleep(1500);
    }
  }
  return null;
}

async function getPlayability() {
  return safeEvalOnFreshWatchTab(`
    (() => {
      const pr = window.ytInitialPlayerResponse?.playabilityStatus;
      const status = pr?.status ?? null;
      const reason = pr?.reason ?? pr?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText ?? null;
      const errorOverlay = !!document.querySelector('.ytp-error');
      return { status, reason, errorOverlay };
    })()
  `);
}

async function reloadWatchTab() {
  const tab = await freshWatchTab();
  if (!tab) return;
  for (let i = 0; i < 3; i++) {
    try {
      const socket = await openSocket(tab.webSocketDebuggerUrl);
      try { await cdpSend(socket, "Page.reload", { ignoreCache: false }); }
      finally { socket.close(); }
      return;
    } catch { await sleep(1500); }
  }
}

async function waitForPlayable(maxReloads = 15) {
  for (let attempt = 0; attempt <= maxReloads; attempt++) {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const p = await getPlayability();
      if (p?.status === "OK" && !p.errorOverlay) return { ok: true, attempt };
      if (p?.status && p.status !== "OK") break;
      await sleep(750);
    }
    if (attempt === maxReloads) {
      const p = await getPlayability();
      return { ok: false, reason: `unplayable after ${maxReloads + 1} attempts: ${p?.status ?? "?"} / ${p?.reason ?? ""}`, last: p };
    }
    const p = await getPlayability();
    console.error(JSON.stringify({ note: "unplayable, reloading", attempt, status: p?.status, reason: p?.reason }));
    await reloadWatchTab();
    await sleep(3000);
  }
  return { ok: false, reason: "unplayable loop exited" };
}

async function waitForDownloadButton() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = await safeEvalOnFreshWatchTab(`
      (() => {
        const host = document.querySelector('.ytdl-download-button');
        if (!host) return null;
        const btn = host.querySelector('button') || (host.matches('button') ? host : null);
        if (!btn) return null;
        return (btn.getAttribute('aria-label') || btn.textContent || '').trim();
      })()
    `);
    if (state) return state;
    await sleep(500);
  }
  return null;
}

async function clickDownload() {
  return safeEvalOnFreshWatchTab(`
    (() => {
      const host = document.querySelector('.ytdl-download-button');
      if (!host) return { ok: false, reason: 'no .ytdl-download-button' };
      const btn = host.querySelector('button') ?? (host.matches('button') ? host : null);
      if (!btn) return { ok: false, reason: 'no button inside .ytdl-download-button' };
      btn.click();
      return { ok: true };
    })()
  `);
}

(async () => {
  const start = Date.now();
  const watchTab = await freshWatchTab();
  if (!watchTab) {
    console.log(JSON.stringify({ ok: false, reason: "no YT watch tab open" }));
    process.exit(1);
  }
  const sw = await freshSw();
  if (!sw) {
    console.log(JSON.stringify({ ok: false, reason: "no extension SW target" }));
    process.exit(1);
  }
  const beforeIds = await snapshotDownloadIds();

  const playable = await waitForPlayable();
  if (!playable.ok) {
    console.log(JSON.stringify({ ok: false, reason: playable.reason }));
    process.exit(1);
  }

  const btnLabel = await waitForDownloadButton();
  if (!btnLabel) {
    console.log(JSON.stringify({ ok: false, reason: "extension Download button never mounted" }));
    process.exit(1);
  }
  const clickRes = await clickDownload();
  if (!clickRes?.ok) {
    console.log(JSON.stringify({ ok: false, reason: clickRes?.reason ?? "click failed" }));
    process.exit(1);
  }

  const deadline = start + TIMEOUT_MS;
  const result = await pollForNewCompletion(beforeIds, deadline);
  const durationMs = Date.now() - start;
  if (result.ok) {
    console.log(JSON.stringify({ ok: true, filename: result.item.filename, bytes: result.item.bytesReceived, durationMs }));
    process.exit(0);
  } else {
    console.log(JSON.stringify({ ok: false, reason: result.reason, item: result.item, durationMs }));
    process.exit(1);
  }
})().catch(e => {
  console.log(JSON.stringify({ ok: false, reason: `script error: ${e.message}` }));
  process.exit(2);
});
