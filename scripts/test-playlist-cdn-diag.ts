// Trigger download of first 2 playlist videos and capture CDN fallback diagnostic logs
import { fetchTargets, attachCdpMonitor } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";
const EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const POLL_DURATION_MS = 120_000;

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function openSession(wsUrl: string) {
  return new Promise<{
    send: (method: string, params?: object) => Promise<unknown>;
    close: () => void;
  }>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    ws.on("open", () => resolve({
      send(method: string, params: object = {}) {
        return new Promise((res, rej) => {
          const id = msgId++;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { ws.close(); }
    }));
    ws.on("message", data => {
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const handler = pending.get(msg.id);
        if (handler) {
          pending.delete(msg.id);
          if (msg.error) handler.reject(msg.error);
          else handler.resolve(msg.result);
        }
      }
    });
    ws.on("error", reject);
  });
}

async function evalPage(session: Awaited<ReturnType<typeof openSession>>, expression: string) {
  const r = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true
  }) as { result: { value: unknown } };
  return r.result.value;
}

async function evalSw(session: Awaited<ReturnType<typeof openSession>>, expression: string) {
  const r = await session.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: unknown } };
  return r.result.value;
}

async function main() {
  const targets = await fetchTargets(CDP_PORT);
  const playlistPage = targets.find(t => t.type === "page" && t.url?.includes(PLAYLIST_ID));
  const sw = targets.find(t => t.type === "service_worker" && t.url?.includes(EXT_ID));

  if (!playlistPage?.webSocketDebuggerUrl) {
    console.error("Playlist tab not found. Open the TalkLinked playlist in Chrome.");
    console.log("Available pages:", targets.filter(t => t.type === "page").map(t => t.url?.slice(0, 100)));
    process.exit(1);
  }

  console.log("Playlist tab:", playlistPage.url?.slice(0, 100));
  console.log("SW:", sw ? "found" : "NOT found");

  // Attach console monitor to SW and playlist page
  if (sw?.webSocketDebuggerUrl) {
    const swMonitor = attachCdpMonitor(sw.webSocketDebuggerUrl, "SW", true);
    setTimeout(() => swMonitor.close(), POLL_DURATION_MS);
  }

  const offscreen = targets.find(t => (t.url ?? "").includes("offscreen.html"));
  if (offscreen?.webSocketDebuggerUrl) {
    const offscreenMonitor = attachCdpMonitor(offscreen.webSocketDebuggerUrl, "OFFSCREEN");
    setTimeout(() => offscreenMonitor.close(), POLL_DURATION_MS);
  }

  const playlistMonitor = attachCdpMonitor(playlistPage.webSocketDebuggerUrl, "PAGE");
  setTimeout(() => playlistMonitor.close(), POLL_DURATION_MS);

  const pageSession = await openSession(playlistPage.webSocketDebuggerUrl);
  const swSession = sw?.webSocketDebuggerUrl ? await openSession(sw.webSocketDebuggerUrl) : null;

  // Cancel any in-progress batch
  await evalPage(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const stopBtn = allBtns.find(b => {
        const label = (b.getAttribute('aria-label') || b.textContent?.trim() || '').toLowerCase();
        return label.includes('cancel') || label.includes('stop');
      });
      if (stopBtn) { stopBtn.click(); return 'stopped'; }
      return 'nothing to stop';
    })()
  `);
  await sleep(800);

  // Clear all checkboxes
  await evalPage(pageSession, `
    Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label="Select for download"]'))
      .filter(cb => cb.getAttribute('aria-checked') === 'true')
      .forEach(cb => { cb.setAttribute('aria-checked','false'); cb.dispatchEvent(new Event('change',{bubbles:true})); })
  `);
  await sleep(300);

  // Select first 2 videos - scroll into view first, handle disabled state
  const selectResult = await evalPage(pageSession, `
    (() => {
      const items = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
      const results = [];
      for (const i of [0, 1]) {
        const item = items[i];
        if (!item) { results.push({ i, error: 'not found' }); continue; }
        item.scrollIntoView({ block: 'center' });
        const cb = item.querySelector('tp-yt-paper-checkbox[aria-label="Select for download"]');
        if (!cb) { results.push({ i, error: 'no checkbox' }); continue; }
        // Force-enable if disabled (e.g. after failed download)
        cb.removeAttribute('disabled');
        cb.setAttribute('aria-checked', 'false');
        cb.removeAttribute('checked');
        cb.click();
        results.push({ i, title: item.querySelector('a#video-title')?.textContent?.trim()?.slice(0, 50) });
      }
      return JSON.stringify(results);
    })()
  `);
  console.log("Selected:", selectResult);
  await sleep(400);

  // Set Single ZIP mode
  const zipResult = await evalPage(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const btn = allBtns.find(b => b.getAttribute('aria-label') === 'Single ZIP');
      if (!btn) return JSON.stringify({ notFound: true, btns: allBtns.map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0,15) });
      btn.click();
      return JSON.stringify({ clicked: true });
    })()
  `);
  console.log("ZIP mode:", zipResult);
  await sleep(300);

  // Click download
  const dlResult = await evalPage(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const btn = allBtns.find(b => {
        const label = (b.getAttribute('aria-label') || '').toLowerCase();
        return label.startsWith('download') && !label.includes('whole');
      });
      if (!btn) return JSON.stringify({ notFound: true, labels: allBtns.map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0,15) });
      btn.click();
      return JSON.stringify({ clicked: true, label: btn.getAttribute('aria-label') });
    })()
  `);
  console.log("Download started:", dlResult);
  console.log("\nMonitoring SW console for CDN fallback logs...");

  // Poll for completion
  for (let tick = 0; tick < 60; tick++) {
    await sleep(2000);
    if (!swSession) break;

    const state = await evalSw(swSession, `
      const r = await chrome.storage.local.get(['videoQueue', 'statusProgress']);
      return JSON.stringify({ q: r.videoQueue?.length ?? 0, p: Object.keys(r.statusProgress ?? {}) });
    `);
    const { q, p } = JSON.parse(state as string) as { q: number; p: string[] };

    if (tick % 5 === 0) {
      console.log(`[${tick * 2}s] queue=${q} inProgress=${JSON.stringify(p)}`);
    }

    if (q === 0 && p.length === 0 && tick > 2) {
      console.log("\nQueue cleared - checking downloads...");
      break;
    }
  }

  // Check recent downloads
  if (swSession) {
    const dlCheck = await evalSw(swSession, `
      const dl = await chrome.downloads.search({ limit: 5, orderBy: ['-startTime'] });
      return JSON.stringify(dl.map(d => ({ filename: (d.filename||'').split('\\\\').pop(), state: d.state, fileSize: d.fileSize })));
    `);
    console.log("Recent downloads:", dlCheck);
  }

  pageSession.close();
  swSession?.close();
}

main().catch(console.error);
