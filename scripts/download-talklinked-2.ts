import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

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

async function eval_(session: Awaited<ReturnType<typeof openSession>>, expression: string) {
  const r = await session.send("Runtime.evaluate", { expression, awaitPromise: false, returnByValue: true }) as { result: { value: unknown } };
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
  const page = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!page) { console.error("Playlist tab not found"); return; }

  const pageSession = await openSession(page.webSocketDebuggerUrl);

  // Check rendered items
  const itemCount = await eval_(pageSession, `document.querySelectorAll('ytd-playlist-video-renderer').length`);
  console.log("Rendered playlist items:", itemCount);

  if (!itemCount || (itemCount as number) < 2) {
    console.log("Not enough items rendered, reloading...");
    await pageSession.send("Page.reload", { ignoreCache: false });
    await sleep(4000);
    const count2 = await eval_(pageSession, `document.querySelectorAll('ytd-playlist-video-renderer').length`);
    console.log("After reload:", count2);
    if (!count2 || (count2 as number) < 2) {
      console.error("Still not enough items. Aborting.");
      pageSession.close();
      return;
    }
  }

  // Get first 2 video titles
  const titles = await eval_(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll('ytd-playlist-video-renderer')).slice(0, 2).map((el, i) => ({
      i,
      title: el.querySelector('a#video-title')?.textContent?.trim()?.slice(0, 60)
    })))
  `);
  console.log("First 2 videos:", titles);

  // Stop any running batch
  const stopResult = await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const stopBtn = allBtns.find(b => (b.getAttribute('aria-label') || '').toLowerCase().includes('stop') || (b.textContent?.trim() || '').toLowerCase().includes('stop'));
      if (stopBtn) { stopBtn.click(); return 'stopped'; }
      return 'no stop needed';
    })()
  `);
  console.log("Stop result:", stopResult);
  await sleep(800);

  // Clear all checkboxes
  await eval_(pageSession, `
    Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label="Select for download"]'))
      .filter(cb => cb.getAttribute('aria-checked') === 'true')
      .forEach(cb => { cb.removeAttribute('checked'); cb.setAttribute('aria-checked','false'); cb.dispatchEvent(new Event('change',{bubbles:true})); })
  `);
  await sleep(400);

  // Select first 2 items
  for (let i = 0; i < 2; i++) {
    const result = await eval_(pageSession, `
      (() => {
        const items = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
        const item = items[${i}];
        if (!item) return 'not found';
        const cb = item.querySelector('tp-yt-paper-checkbox[aria-label="Select for download"]');
        if (!cb) return 'no checkbox';
        cb.click();
        return item.querySelector('a#video-title')?.textContent?.trim()?.slice(0, 50) ?? 'clicked';
      })()
    `);
    console.log(`Selected [${i}]:`, result);
    await sleep(300);
  }

  const selCount = await eval_(pageSession, `document.querySelector('.ytdl-selection-count')?.textContent?.trim()`);
  console.log("Selection count:", selCount);

  // Show available buttons
  const btns = await eval_(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(b => b.getAttribute('aria-label') || b.textContent?.trim()).filter(Boolean))
  `);
  console.log("Available buttons:", btns);

  // Ensure Separate files mode
  const separateResult = await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const btn = allBtns.find(b => b.getAttribute('aria-label') === 'Separate files');
      if (!btn) return 'not found';
      btn.click();
      return 'clicked';
    })()
  `);
  console.log("Separate files:", separateResult);
  await sleep(300);

  // Click download
  const dlResult = await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const btn = allBtns.find(b => {
        const label = b.getAttribute('aria-label') || '';
        return label.toLowerCase().startsWith('download') && !label.toLowerCase().includes('whole');
      });
      if (!btn) return JSON.stringify({ notFound: true, labels: allBtns.map(b => b.getAttribute('aria-label')).filter(Boolean) });
      btn.click();
      return JSON.stringify({ clicked: true, label: btn.getAttribute('aria-label') });
    })()
  `);
  console.log("Download:", dlResult);

  await sleep(2000);

  const swSession = await findSwSession(8000);
  console.log("SW found:", !!swSession);

  // Poll for completion
  console.log("\nPolling for completion...");
  const pollStart = Date.now();
  for (let tick = 0; tick < 120; tick++) {
    await sleep(3000);
    if (!swSession) break;

    const state = await swEval(swSession, `
      const r = await chrome.storage.local.get(['videoQueue','statusProgress']);
      return JSON.stringify({ q: r.videoQueue?.length ?? 0, p: r.statusProgress ?? {} });
    `);
    const { q, p } = JSON.parse(state as string) as { q: number; p: Record<string, unknown> };
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    console.log(`[${elapsed}s] queue=${q} progress=${JSON.stringify(p)}`);

    if (q === 0 && Object.keys(p).length === 0 && tick > 1) {
      console.log("\nQueue empty, checking downloads...");
      break;
    }
  }

  if (swSession) {
    const dlCheck = await swEval(swSession, `
      const dl = await chrome.downloads.search({ limit: 10, orderBy: ['-startTime'] });
      return JSON.stringify(dl.map(d => ({ filename: (d.filename||'').split('\\\\').pop(), state: d.state, fileSize: d.fileSize })));
    `);
    console.log("\nRecent downloads:", dlCheck);
    swSession.close();
  }

  pageSession.close();
}

main().catch(console.error);
