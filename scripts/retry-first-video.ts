// Retry ukYofhuBWEM ("So, you wanna beat China...") as a standalone download with detailed logging
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";
const VIDEO_ID = "ukYofhuBWEM";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void; on: (event: string, handler: (...args: unknown[]) => void) => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();

    ws.on("open", () => {
      resolve({
        send(method: string, params: object = {}) {
          return new Promise((res, rej) => {
            const id = msgId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); },
        on(event: string, handler: (...args: unknown[]) => void) {
          if (!eventHandlers.has(event)) eventHandlers.set(event, []);
          eventHandlers.get(event)!.push(handler);
        }
      });
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const handler = pending.get(msg.id);
        if (handler) {
          pending.delete(msg.id);
          if (msg.error) handler.reject(msg.error);
          else handler.resolve(msg.result);
        }
      } else if (msg.method) {
        const handlers = eventHandlers.get(msg.method) ?? [];
        for (const h of handlers) h(msg.params);
      }
    });

    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function eval_(session: ReturnType<typeof openSession> extends Promise<infer T> ? T : never, expression: string) {
  const r = await session.send("Runtime.evaluate", { expression, awaitPromise: false, returnByValue: true }) as { result: { value: unknown } };
  return r.result.value;
}

async function swEval(session: ReturnType<typeof openSession> extends Promise<infer T> ? T : never, expression: string) {
  const r = await session.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  return r.result.value;
}

async function findSwSession(timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const sw = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
    if (sw) return openSession(sw.webSocketDebuggerUrl);
    await sleep(500);
  }
  return null;
}

async function main() {
  // Get SW session for logging
  const swSession = await findSwSession();
  if (!swSession) { console.error("SW not found"); return; }

  const logs: string[] = [];
  swSession.on("Runtime.consoleAPICalled", (params) => {
    const p = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    const msg = p.args.map(a => a.value ?? a.description ?? "").join(" ");
    logs.push(`[${p.type.toUpperCase()}] ${msg}`);
    if (msg.includes("sabr") || msg.includes("SABR") || msg.includes("attest") || msg.includes("failed") || msg.includes("error") || msg.includes("CDN") || msg.includes("cdn") || msg.includes("ytdl")) {
      console.log(`  SW> ${msg.slice(0, 150)}`);
    }
  });
  await swSession.send("Runtime.enable", {});

  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!page) { console.error("Playlist tab not found"); return; }

  const pageSession = await openSession(page.webSocketDebuggerUrl);

  // Stop any running batch
  await eval_(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));
      const stopBtn = allBtns.find(b => (b.getAttribute('aria-label')||'').toLowerCase().includes('stop'));
      if (stopBtn) { stopBtn.click(); return 'stopped'; }
    })()
  `);
  await sleep(800);

  // Clear all checkboxes
  await eval_(pageSession, `
    Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label="Select for download"]'))
      .filter(cb => cb.getAttribute('aria-checked') === 'true')
      .forEach(cb => { cb.removeAttribute('checked'); cb.setAttribute('aria-checked','false'); cb.dispatchEvent(new Event('change',{bubbles:true})); })
  `);
  await sleep(400);

  // Select only item 0 (ukYofhuBWEM)
  const selectResult = await eval_(pageSession, `
    (() => {
      const item = document.querySelectorAll('ytd-playlist-video-renderer')[0];
      if (!item) return 'no item';
      const cb = item.querySelector('tp-yt-paper-checkbox[aria-label="Select for download"]');
      if (!cb) return 'no checkbox';
      cb.click();
      return 'selected: ' + (item.querySelector('a#video-title')?.textContent?.trim()?.slice(0,50) ?? '?');
    })()
  `);
  console.log("Selected:", selectResult);
  await sleep(400);

  // Show buttons
  const btns = await eval_(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(b => b.getAttribute('aria-label')||b.textContent?.trim()).filter(Boolean))
  `);
  console.log("Available buttons:", btns);

  // Click download
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

  // Poll
  console.log("\nPolling...");
  const pollStart = Date.now();
  for (let tick = 0; tick < 60; tick++) {
    await sleep(3000);
    const state = await swEval(swSession, `
      const r = await chrome.storage.local.get(['videoQueue','statusProgress']);
      return JSON.stringify({ q: r.videoQueue?.length ?? 0, p: r.statusProgress ?? {} });
    `);
    const { q, p } = JSON.parse(state as string) as { q: number; p: Record<string, unknown> };
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    console.log(`[${elapsed}s] queue=${q} progress=${JSON.stringify(p)}`);
    if (q === 0 && Object.keys(p).length === 0 && tick > 0) {
      console.log("Queue empty");
      break;
    }
  }

  // Final state
  const itemState = await eval_(pageSession, `
    (() => {
      const item = document.querySelectorAll('ytd-playlist-video-renderer')[0];
      return JSON.stringify({
        downloadState: item?.querySelector('[data-ytdl-download-state]')?.getAttribute('data-ytdl-download-state'),
        btn: item?.querySelector('button')?.getAttribute('aria-label')?.slice(0, 60)
      });
    })()
  `);
  console.log("\nFinal item state:", itemState);

  const dlCheck = await swEval(swSession, `
    const dl = await chrome.downloads.search({ limit: 5, orderBy: ['-startTime'] });
    return JSON.stringify(dl.map(d => ({ filename: (d.filename||'').split('\\\\').pop(), state: d.state, fileSize: d.fileSize })));
  `);
  console.log("Recent downloads:", dlCheck);

  console.log("\n=== All SW logs ===");
  for (const log of logs.filter(l => l.includes("ytdl") || l.includes("SABR") || l.includes("sabr") || l.includes("attestation") || l.includes("failed") || l.includes("CDN"))) {
    console.log(log.slice(0, 200));
  }

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
