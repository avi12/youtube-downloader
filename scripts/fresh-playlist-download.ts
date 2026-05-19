// Reload playlist page and download first 2 videos fresh
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void; on: (event: string, handler: (...args: unknown[]) => void) => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    const evHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
    ws.on("open", () => resolve({
      send(method: string, params: object = {}) {
        return new Promise((res, rej) => {
          const id = msgId++;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { ws.close(); },
      on(ev: string, h: (...args: unknown[]) => void) {
        if (!evHandlers.has(ev)) evHandlers.set(ev, []);
        evHandlers.get(ev)!.push(h);
      }
    }));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const h = pending.get(msg.id);
        if (h) { pending.delete(msg.id); msg.error ? h.reject(msg.error) : h.resolve(msg.result); }
      } else if (msg.method) {
        (evHandlers.get(msg.method) ?? []).forEach(h => h(msg.params));
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

async function findSw(timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ts = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const sw = ts.find(t => t.type === "service_worker" && t.url.includes("iakm"));
    if (sw) return openSession(sw.webSocketDebuggerUrl);
    await sleep(500);
  }
  return null;
}

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const pageTarget = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!pageTarget) { console.error("Playlist tab not found"); return; }

  // Reload the page fresh
  console.log("Reloading playlist page...");
  const pageSession = await openSession(pageTarget.webSocketDebuggerUrl);
  await pageSession.send("Page.reload", { ignoreCache: false });
  await sleep(5000);  // Wait for page to reload

  // Verify it loaded
  const itemCount = await eval_(pageSession, `document.querySelectorAll('ytd-playlist-video-renderer').length`);
  console.log("Items after reload:", itemCount);

  if (!itemCount || (itemCount as number) < 2) {
    await sleep(3000);
    const count2 = await eval_(pageSession, `document.querySelectorAll('ytd-playlist-video-renderer').length`);
    console.log("Items after extra wait:", count2);
    if (!count2 || (count2 as number) < 2) {
      console.error("Not enough items. Aborting.");
      pageSession.close();
      return;
    }
  }

  // Setup SW logging
  const swSession = await findSw();
  const swLogs: string[] = [];
  if (swSession) {
    await swSession.send("Runtime.enable", {});
    swSession.on("Runtime.consoleAPICalled", (params) => {
      const p = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
      const msg = p.args.map(a => a.value ?? a.description ?? "").join(" ");
      swLogs.push(`[${p.type}] ${msg}`);
      if (msg.includes("ytdl") || msg.includes("attest") || msg.includes("SABR") || msg.includes("CDN") || msg.includes("ffmpeg")) {
        console.log(`  SW> ${msg.slice(0, 160)}`);
      }
    });
  }

  // Get first 2 video titles
  const titles = await eval_(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll('ytd-playlist-video-renderer')).slice(0,2).map((el,i) => ({
      i, title: el.querySelector('a#video-title')?.textContent?.trim()?.slice(0,50),
      id: el.querySelector('a#video-title')?.href?.match(/v=([^&]+)/)?.[1]
    })))
  `);
  console.log("First 2 videos:", titles);

  // Clear all checkboxes
  await eval_(pageSession, `
    Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label="Select for download"]'))
      .filter(cb => cb.getAttribute('aria-checked') === 'true')
      .forEach(cb => { cb.removeAttribute('checked'); cb.setAttribute('aria-checked','false'); cb.dispatchEvent(new Event('change',{bubbles:true})); })
  `);
  await sleep(400);

  // Select first 2 videos
  for (let i = 0; i < 2; i++) {
    await eval_(pageSession, `
      (() => {
        const items = document.querySelectorAll('ytd-playlist-video-renderer');
        const item = items[${i}];
        if (!item) return;
        const cb = item.querySelector('tp-yt-paper-checkbox[aria-label="Select for download"]');
        cb?.click();
      })()
    `);
    await sleep(300);
  }

  const selCount = await eval_(pageSession, `document.querySelector('.ytdl-selection-count')?.textContent?.trim()`);
  console.log("Selection count:", selCount);

  // Download
  const dlResult = await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const btn = allBtns.find(b => {
        const label = b.getAttribute('aria-label') || '';
        return label.toLowerCase().startsWith('download') && !label.toLowerCase().includes('whole');
      });
      if (!btn) return JSON.stringify({ notFound: true });
      btn.click();
      return JSON.stringify({ clicked: true, label: btn.getAttribute('aria-label') });
    })()
  `);
  console.log("Download:", dlResult);

  if (!swSession) { console.error("No SW"); pageSession.close(); return; }

  // Poll
  console.log("\nPolling...");
  const start = Date.now();
  let lastQ = -1;
  for (let tick = 0; tick < 180; tick++) {
    await sleep(3000);
    const state = await swEval(swSession, `
      const r = await chrome.storage.local.get(['videoQueue','statusProgress']);
      return JSON.stringify({ q: r.videoQueue?.length ?? 0, p: r.statusProgress ?? {} });
    `);
    const { q, p } = JSON.parse(state as string) as { q: number; p: Record<string, unknown> };
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (q !== lastQ || Object.keys(p).length > 0) {
      console.log(`[${elapsed}s] queue=${q} progress=${JSON.stringify(p)}`);
      lastQ = q;
    } else if (tick % 5 === 0) {
      console.log(`[${elapsed}s] queue=${q}`);
    }

    if (q === 0 && Object.keys(p).length === 0 && tick > 1) {
      console.log("Queue empty");
      break;
    }
  }

  // Item states
  const states = await eval_(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll('ytd-playlist-video-renderer')).slice(0,2).map((el,i) => ({
      i, title: el.querySelector('a#video-title')?.textContent?.trim()?.slice(0,40),
      state: el.querySelector('[data-ytdl-download-state]')?.getAttribute('data-ytdl-download-state'),
      btn: el.querySelector('button')?.getAttribute('aria-label')?.slice(0,50)
    })))
  `);
  console.log("Final states:", states);

  // Recent downloads
  const dlCheck = await swEval(swSession, `
    const dl = await chrome.downloads.search({ limit: 5, orderBy: ['-startTime'] });
    return JSON.stringify(dl.map(d => ({ filename: (d.filename||'').split('\\\\').pop(), state: d.state, fileSize: d.fileSize })));
  `);
  console.log("Recent downloads:", dlCheck);

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
