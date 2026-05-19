import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

type Session = {
  send: (method: string, params?: object) => Promise<unknown>;
  close: () => void;
  onEvent: (cb: (ev: unknown) => void) => void;
};

function openSession(wsUrl: string): Promise<Session> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    let eventHandler: ((ev: unknown) => void) | null = null;
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
        onEvent(cb) { eventHandler = cb; }
      });
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const h = pending.get(msg.id);
        if (h) { pending.delete(msg.id); if (msg.error) h.reject(msg.error); else h.resolve(msg.result); }
      } else if (eventHandler) { eventHandler(msg); }
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
type Target = { type: string; url: string; id: string; webSocketDebuggerUrl: string };
type EvalResult = { result: { value: string; type?: string; description?: string }; exceptionDetails?: unknown };

async function reval(session: Session, expression: string, awaitPromise = false) {
  const r = await session.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }) as EvalResult;
  if (r.exceptionDetails) console.error("Exception:", JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function main() {
  const targets = await fetch(`${CDP_URL}/json`).then(r => r.json()) as Target[];

  // Find the playlist page
  const playlistPage = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!playlistPage) { console.error("Playlist tab not found"); return; }
  console.log("Playlist tab:", playlistPage.url);

  // Find the SW
  const swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!swTarget) { console.error("SW not found"); return; }
  console.log("SW target:", swTarget.url);

  const pageSession = await openSession(playlistPage.webSocketDebuggerUrl);
  const swSession = await openSession(swTarget.webSocketDebuggerUrl);

  // Collect all logs
  const swLogs: string[] = [];
  const pageLogs: string[] = [];
  const swNetReqs: Array<{ url: string; method: string }> = [];
  const swNetResps: Array<{ url: string; status: number }> = [];
  const pageNetReqs: Array<{ url: string; method: string }> = [];
  const pageNetResps: Array<{ url: string; status: number }> = [];

  swSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string; preview?: { properties?: Array<{name: string; value?: string}> } }>) ?? [];
      const msg = args.map(a => {
        if (a.value !== undefined) return String(a.value);
        if (a.description) return a.description;
        if (a.preview?.properties) return JSON.stringify(Object.fromEntries(a.preview.properties.map(p => [p.name, p.value])));
        return "[object]";
      }).join(" ");
      swLogs.push(msg);
      console.log(`[SW] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const desc = (event.params?.exceptionDetails as { exception?: { description?: string } })?.exception?.description ?? "unknown";
      swLogs.push("EXCEPTION: " + desc);
      console.log(`[SW EXCEPTION] ${desc.slice(0, 300)}`);
    }
    if (event.method === "Network.requestWillBeSent") {
      const req = (event.params?.request as { url: string; method: string } | undefined);
      if (req?.url.includes("googlevideo.com") || req?.url.includes("youtube.com/youtubei")) {
        swNetReqs.push({ url: req.url.slice(0, 150), method: req.method });
        console.log(`[SW REQ] ${req.method} ${req.url.slice(0, 120)}`);
      }
    }
    if (event.method === "Network.responseReceived") {
      const resp = (event.params?.response as { url: string; status: number } | undefined);
      if (resp?.url.includes("googlevideo.com") || resp?.url.includes("youtube.com/youtubei")) {
        swNetResps.push({ url: resp.url.slice(0, 100), status: resp.status });
        console.log(`[SW RESP] ${resp.status} ${resp.url.slice(0, 100)}`);
      }
    }
  });

  pageSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      pageLogs.push(msg);
    }
    if (event.method === "Network.requestWillBeSent") {
      const req = (event.params?.request as { url: string; method: string } | undefined);
      if (req?.url.includes("googlevideo.com")) {
        pageNetReqs.push({ url: req.url.slice(0, 120), method: req.method });
        console.log(`[PAGE REQ] ${req.method} ${req.url.slice(0, 100)}`);
      }
    }
    if (event.method === "Network.responseReceived") {
      const resp = (event.params?.response as { url: string; status: number } | undefined);
      if (resp?.url.includes("googlevideo.com")) {
        pageNetResps.push({ url: resp.url.slice(0, 80), status: resp.status });
        console.log(`[PAGE RESP] ${resp.status} ${resp.url.slice(0, 80)}`);
      }
    }
  });

  await swSession.send("Runtime.enable", {});
  await swSession.send("Network.enable", {});
  await pageSession.send("Runtime.enable", {});
  await pageSession.send("Network.enable", {});

  console.log("\n=== Checking current playlist downloader state ===");
  const buttons = await reval(pageSession,
    "JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(b => ({ label: b.getAttribute('aria-label'), text: b.textContent?.trim().slice(0,30) })).slice(0,20))"
  );
  console.log("Buttons:", buttons);

  // Check storage
  const storageCheck = await reval(swSession,
    "(async () => { const r = await chrome.storage.local.get(null); return JSON.stringify(Object.keys(r)); })()",
    true
  );
  console.log("All storage keys:", storageCheck);

  const storageVals = await reval(swSession,
    "(async () => { const r = await chrome.storage.local.get(['videoQueue','statusProgress','videoDetails']); return JSON.stringify(r); })()",
    true
  );
  console.log("Storage values:", storageVals);

  // Now select + download
  console.log("\n=== Selecting item 2 and downloading ===");

  // Clear selections first
  await reval(pageSession, `
    Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label="Select for download"]'))
      .filter(cb => cb.getAttribute("aria-checked") === "true")
      .forEach(cb => { cb.removeAttribute("checked"); cb.setAttribute("aria-checked","false"); cb.dispatchEvent(new Event("change",{bubbles:true})); })
  `);
  await sleep(300);

  // Select item 2
  const selectResult = await reval(pageSession, `
    (() => {
      const items = Array.from(document.querySelectorAll("ytd-playlist-video-renderer"));
      console.log("Total items:", items.length);
      const item = items[1];
      if (!item) return JSON.stringify({ error: "not found", count: items.length });
      const cb = item.querySelector('tp-yt-paper-checkbox[aria-label="Select for download"]');
      if (!cb) return JSON.stringify({ error: "no checkbox", firstChild: item.firstElementChild?.tagName });
      (cb as HTMLElement).click();
      return JSON.stringify({ title: item.querySelector("a#video-title")?.textContent?.trim()?.slice(0, 60), cbAria: cb.getAttribute("aria-checked") });
    })()
  `);
  console.log("Select result:", selectResult);
  await sleep(500);

  const selCount = await reval(pageSession, "document.querySelector('.ytdl-selection-count')?.textContent?.trim()");
  console.log("Selection count:", selCount);

  // Set Separate files
  const sepResult = await reval(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll("[data-ytdl-playlist-downloader] button"));
      const btn = allBtns.find(b => b.getAttribute("aria-label") === "Separate files");
      if (!btn) return JSON.stringify({ notFound: true });
      (btn as HTMLElement).click();
      return JSON.stringify({ clicked: true });
    })()
  `);
  console.log("Separate files:", sepResult);
  await sleep(300);

  // Click download
  const dlResult = await reval(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll("[data-ytdl-playlist-downloader] button"));
      const btn = allBtns.find(b => {
        const label = b.getAttribute("aria-label") || "";
        return label.toLowerCase().startsWith("download") && !label.toLowerCase().includes("whole");
      });
      if (!btn) return JSON.stringify({ notFound: true, labels: allBtns.map(b => b.getAttribute("aria-label")).filter(Boolean).slice(0,20) });
      (btn as HTMLElement).click();
      return JSON.stringify({ clicked: true, label: btn.getAttribute("aria-label") });
    })()
  `);
  console.log("Download click:", dlResult);

  // Wait for SW to receive the message
  await sleep(3000);

  // Check storage again
  const storageAfter = await reval(swSession,
    "(async () => { const r = await chrome.storage.local.get(['videoQueue','statusProgress','videoDetails']); return JSON.stringify(r); })()",
    true
  );
  console.log("Storage after download click:", storageAfter);

  // Poll for 60s
  console.log("\n=== Polling ===");
  const pollStart = Date.now();
  for (let tick = 0; tick < 30; tick++) {
    await sleep(2000);
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    const state = await reval(swSession,
      "(async () => { const r = await chrome.storage.local.get(['videoQueue','statusProgress']); return JSON.stringify({ q: r.videoQueue?.length ?? 0, p: r.statusProgress ?? {} }); })()",
      true
    );
    const { q, p } = JSON.parse(state) as { q: number; p: Record<string, unknown> };
    console.log(`[${elapsed}s] queue=${q} progress=${JSON.stringify(Object.keys(p))}`);
    if (Object.keys(p).length > 0) console.log("  values:", JSON.stringify(p).slice(0, 300));
    if (q === 0 && Object.keys(p).length === 0 && tick > 2) break;
  }

  // Final checks
  const dlCheck = await reval(swSession,
    `(async () => {
      const dl = await chrome.downloads.search({ limit: 3, orderBy: ["-startTime"] });
      return JSON.stringify(dl.map(d => ({ filename: (d.filename||"").split("\\\\").pop(), state: d.state, fileSize: d.fileSize, error: d.error })));
    })()`,
    true
  );
  console.log("\nRecent downloads:", dlCheck);

  const itemStates = await reval(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll("ytd-playlist-video-renderer")).slice(0, 5).map((el, i) => ({
      i,
      title: el.querySelector("a#video-title")?.textContent?.trim()?.slice(0, 40),
      state: el.querySelector("[data-ytdl-download-state]")?.getAttribute("data-ytdl-download-state")
    })))
  `);
  console.log("Item states (0-4):", itemStates);

  console.log("\n=== SUMMARY ===");
  console.log(`SW logs collected: ${swLogs.length}`);
  console.log(`Page logs collected: ${pageLogs.length}`);
  console.log(`SW googlevideo requests: ${swNetReqs.length}`);
  swNetReqs.forEach(r => console.log(`  ${r.method} ${r.url}`));
  console.log(`SW googlevideo responses: ${swNetResps.length}`);
  swNetResps.forEach(r => console.log(`  ${r.status} ${r.url}`));
  console.log(`Page googlevideo requests: ${pageNetReqs.length}`);
  console.log(`Page googlevideo responses: ${pageNetResps.length}`);

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
