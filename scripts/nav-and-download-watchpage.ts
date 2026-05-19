// Navigate to ukYofhuBWEM, start playback, capture SABR credentials, then download
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

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
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const existingWatch = targets.find(t => t.type === "page" && t.url.includes("watch?v="));
  if (!existingWatch) { console.error("No watch tab available"); return; }

  // Navigate to ukYofhuBWEM
  console.log("Navigating to ukYofhuBWEM...");
  const navSession = await openSession(existingWatch.webSocketDebuggerUrl);
  await navSession.send("Page.navigate", { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
  navSession.close();
  await sleep(6000);

  // Reconnect to the tab
  const targets2 = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const watchTab = targets2.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) { console.error("Watch tab not found"); return; }

  const watchSession = await openSession(watchTab.webSocketDebuggerUrl);
  const swSession = await findSwSession();
  if (!swSession) { console.error("SW not found"); return; }

  const swLogs: string[] = [];
  await swSession.send("Runtime.enable", {});
  swSession.on("Runtime.consoleAPICalled", (params) => {
    const p = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    const msg = p.args.map(a => a.value ?? a.description ?? "").join(" ");
    swLogs.push(msg);
    if (msg.includes("ytdl") || msg.includes("attest") || msg.includes("sabr") || msg.includes("SABR")) {
      console.log(`  SW> ${msg.slice(0, 160)}`);
    }
  });

  // Check video element state
  const state1 = await eval_(watchSession, `(() => {
    const v = document.querySelector('video');
    return JSON.stringify({ ct: v?.currentTime, paused: v?.paused, bufEnd: v?.buffered?.length ? v.buffered.end(v.buffered.length-1) : 0, ns: v?.networkState, vs: v?.videoWidth });
  })()`);
  console.log("Player state:", state1);

  // Start playback
  await eval_(watchSession, `document.querySelector('video')?.play()?.catch(()=>{})`);
  console.log("Play initiated, waiting 5s for buffering...");
  await sleep(5000);

  const state2 = await eval_(watchSession, `(() => {
    const v = document.querySelector('video');
    return JSON.stringify({ ct: v?.currentTime, bufEnd: v?.buffered?.length ? v.buffered.end(v.buffered.length-1) : 0, ns: v?.networkState });
  })()`);
  console.log("Player state after 5s:", state2);

  // Check if SW captured SABR data for this tab
  const tabQuery = await swEval(swSession, `
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/watch?v=${VIDEO_ID}*' });
    return JSON.stringify(tabs.map(t => ({ id: t.id, url: t.url?.slice(0,80) })));
  `);
  console.log("YouTube tabs:", tabQuery);

  // Now look for the extension download button on the page
  const dlButton = await eval_(watchSession, `(() => {
    // Try various selectors for extension download button
    const selectors = [
      '[class*="ytdl"]',
      '[data-ytdl]',
      '[id*="ytdl"]',
      'button[aria-label*="Download"]',
      '.ytdl-button'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return JSON.stringify({ found: sel, tag: el.tagName, label: el.getAttribute('aria-label')?.slice(0,60), class: el.className?.slice(0,60) });
    }
    // Look for any ytdl elements
    const all = Array.from(document.querySelectorAll('*')).filter(el => el.id?.includes('ytdl') || (el.className && typeof el.className === 'string' && el.className.includes('ytdl')));
    return JSON.stringify({ notFound: true, ytdlElements: all.slice(0,5).map(el => ({ tag: el.tagName, id: el.id, class: el.className?.slice?.(0,50) })) });
  })()`);
  console.log("Extension elements:", dlButton);

  watchSession.close();
  swSession.close();
}

main().catch(console.error);
