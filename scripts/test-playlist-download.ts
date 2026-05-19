// Stop stuck batch, then select item 2 (1-indexed), Separate files, verify download
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const TALKINKED_LIST = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

    ws.on("open", () => {
      resolve({
        send(method: string, params: object = {}) {
          return new Promise((res, rej) => {
            const id = msgId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); }
      });
    });

    ws.on("message", (data) => {
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function eval_(session: Awaited<ReturnType<typeof openSession>>, expression: string, awaitPromise = false) {
  const r = await session.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }) as { result: { value: unknown } };
  return r.result.value;
}

async function swEval(session: Awaited<ReturnType<typeof openSession>>, expression: string) {
  const r = await session.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  return r.result.value;
}

async function findSwSession(timeout = 10000): Promise<Awaited<ReturnType<typeof openSession>> | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const sw = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
    if (sw) return openSession(sw.webSocketDebuggerUrl);
    await sleep(1000);
  }
  return null;
}

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = targets.find(t => t.type === "page" && t.url.includes(TALKINKED_LIST));
  if (!page) { console.error("Playlist tab not found"); return; }

  const pageSession = await openSession(page.webSocketDebuggerUrl);
  // Wake the SW by sending a storage event, then find it
  let swSession = await findSwSession();

  // --- Step 0: Show current downloader state ---
  const currentBtns = await eval_(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(b => b.getAttribute('aria-label') || b.textContent?.trim()).filter(Boolean).slice(0, 20))
  `);
  console.log("Current downloader buttons:", currentBtns);

  // Stop any running batch
  const stopResult = await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const stopBtn = allBtns.find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('stop') || (b.textContent?.trim() || '').toLowerCase().includes('stop'));
      if (stopBtn) { stopBtn.click(); return JSON.stringify({ stopped: true, label: stopBtn.getAttribute('aria-label') || stopBtn.textContent?.trim() }); }
      return JSON.stringify({ noStop: true });
    })()
  `);
  console.log("Stop batch:", stopResult);
  await sleep(1000);

  // --- Step 1: Clear all checkboxes ---
  await eval_(pageSession, `
    Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label="Select for download"]'))
      .filter(cb => cb.getAttribute('aria-checked') === 'true')
      .forEach(cb => { cb.removeAttribute('checked'); cb.setAttribute('aria-checked','false'); cb.dispatchEvent(new Event('change',{bubbles:true})); })
  `);
  await sleep(300);

  // --- Step 2: Select item 2 only (1-indexed) ---
  console.log("\nSelecting item 2 (1-indexed)...");
  const selectResult = await eval_(pageSession, `
    (() => {
      const items = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
      const item = items[1];
      if (!item) return JSON.stringify({ error: 'not found' });
      const cb = item.querySelector('tp-yt-paper-checkbox[aria-label="Select for download"]');
      if (!cb) return JSON.stringify({ error: 'no checkbox' });
      cb.click();
      return JSON.stringify({ title: item.querySelector('a#video-title')?.textContent?.trim()?.slice(0, 50) });
    })()
  `);
  console.log("Selected:", selectResult);
  await sleep(400);

  const selCount = await eval_(pageSession, `document.querySelector('.ytdl-selection-count')?.textContent?.trim()`);
  console.log("Selection count:", selCount);

  // --- Step 3: Ensure "Separate files" mode (NOT Single ZIP) ---
  const separateResult = await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const btn = allBtns.find(b => b.getAttribute('aria-label') === 'Separate files');
      if (!btn) return JSON.stringify({ notFound: true, btns: allBtns.map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0,15) });
      btn.click();
      return JSON.stringify({ clicked: true });
    })()
  `);
  console.log("Separate files mode:", separateResult);
  await sleep(300);

  // --- Step 4: Click download ---
  const dlResult = await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const btn = allBtns.find(b => {
        const label = b.getAttribute('aria-label') || '';
        return label.toLowerCase().startsWith('download') && !label.toLowerCase().includes('whole');
      });
      if (!btn) return JSON.stringify({ notFound: true, labels: allBtns.map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0,15) });
      btn.click();
      return JSON.stringify({ clicked: true, label: btn.getAttribute('aria-label') });
    })()
  `);
  console.log("Download start:", dlResult);

  await sleep(1500);

  // Re-find SW after download started (it may have woken up)
  if (!swSession) {
    swSession = await findSwSession(5000);
    console.log("SW found after download start:", !!swSession);
  }

  // Confirm storage has the video
  if (swSession) {
    const storage = await swEval(swSession, `
      const r = await chrome.storage.local.get(['videoQueue', 'videoDetails']);
      return JSON.stringify({ queue: r.videoQueue, details: r.videoDetails });
    `);
    console.log("\nStorage after start:", storage);
  }

  // --- Step 5: Poll for completion ---
  console.log("\nPolling for download completion...");
  const pollStart = Date.now();
  let lastProgressLog = "";
  for (let tick = 0; tick < 180; tick++) {
    await sleep(2000);
    if (!swSession) { console.log("No SW session, stopping poll"); break; }

    const state = await swEval(swSession, `
      const r = await chrome.storage.local.get(['videoQueue','statusProgress']);
      return JSON.stringify({ q: r.videoQueue?.length ?? 0, p: r.statusProgress ?? {} });
    `);
    const { q, p } = JSON.parse(state as string) as { q: number; p: Record<string, unknown> };
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    const progressKeys = Object.keys(p);
    const logLine = `[${elapsed}s] queue=${q} progress=${JSON.stringify(progressKeys)}`;

    if (logLine !== lastProgressLog) {
      console.log(logLine);
      lastProgressLog = logLine;
    } else if (tick % 10 === 0) {
      console.log(logLine);
    }

    if (q === 0 && progressKeys.length === 0 && tick > 1) {
      console.log("\n✓ Queue cleared and no active progress");
      break;
    }

    // Show progress values if any
    if (progressKeys.length > 0 && tick % 5 === 0) {
      console.log("  Progress values:", JSON.stringify(p));
    }
  }

  // --- Step 6: Check recent downloads ---
  if (swSession) {
    const dlCheck = await swEval(swSession, `
      const dl = await chrome.downloads.search({ limit: 8, orderBy: ['-startTime'] });
      return JSON.stringify(dl.map(d => ({ filename: (d.filename||'').split('\\\\').pop(), state: d.state, fileSize: d.fileSize })));
    `);
    console.log("\nRecent downloads:", dlCheck);
  }

  // Item state check
  const states = await eval_(pageSession, `
    JSON.stringify([1].map(i => {
      const el = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[i];
      return { i, title: el?.querySelector('a#video-title')?.textContent?.trim()?.slice(0,40), state: el?.querySelector('[data-ytdl-download-state]')?.getAttribute('data-ytdl-download-state') };
    }))
  `);
  console.log("Item states:", states);

  pageSession.close();
  swSession?.close();
}

main().catch(console.error);
