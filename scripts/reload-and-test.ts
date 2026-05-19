import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const EXTENSION_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
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
        onEvent(cb: (ev: unknown) => void) { eventHandler = cb; }
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
      } else if (eventHandler) {
        eventHandler(msg);
      }
    });

    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

type Target = { type: string; url: string; id: string; webSocketDebuggerUrl: string };

async function getTargets() {
  return (await (await fetch(`${CDP_URL}/json`)).json()) as Target[];
}

type EvalResult = { result: { value: string } };
async function reval(session: Session, expression: string, awaitPromise = false) {
  return (await session.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }) as EvalResult).result.value;
}

async function main() {
  // --- Step 1: Reload extension ---
  console.log("=== STEP 1: Reloading extension ===");
  const targets = await getTargets();
  const extPage = targets.find(t => t.url === "chrome://extensions/");
  if (!extPage) { console.error("Extensions page not found"); return; }

  const extSession = await openSession(extPage.webSocketDebuggerUrl);
  const reloadResult = await reval(extSession, `
    (async () => {
      const mgr = document.querySelector("extensions-manager");
      const itemList = mgr?.shadowRoot?.querySelector("extensions-item-list");
      const items = itemList?.shadowRoot?.querySelectorAll("extensions-item") ?? [];
      for (const item of items) {
        const id = item.getAttribute("id");
        if (id === "${EXTENSION_ID}") {
          const devBtn = item.shadowRoot?.querySelector("#dev-reload-button");
          if (devBtn) { (devBtn as HTMLElement).click(); return "reloaded via dev-reload-button"; }
          const reloadBtn = item.shadowRoot?.querySelector(".reload-button");
          if (reloadBtn) { (reloadBtn as HTMLElement).click(); return "reloaded via reload-button"; }
          return "no reload button found for id=" + id;
        }
      }
      const ids = Array.from(items).map(i => i.getAttribute("id"));
      return "extension not found, available: " + JSON.stringify(ids);
    })()
  `, true);
  console.log("Reload result:", reloadResult);
  extSession.close();

  await sleep(3000);

  // --- Step 2: Verify playlist tab ---
  console.log("\n=== STEP 2: Finding playlist tab ===");
  const targets2 = await getTargets();
  const playlistPage = targets2.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!playlistPage) { console.error("Playlist tab not found"); return; }
  console.log("Playlist tab:", playlistPage.url);

  const pageSession = await openSession(playlistPage.webSocketDebuggerUrl);

  await sleep(3000);

  const readyState = await reval(pageSession, "document.readyState");
  console.log("Page readyState:", readyState);

  // --- Step 3: Network monitoring on page ---
  console.log("\n=== STEP 3: Network monitoring setup ===");
  const pageNetReqs: Array<{ url: string; method: string }> = [];
  const pageNetResps: Array<{ url: string; status: number }> = [];

  pageSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: { request?: { url: string; method: string }; response?: { url: string; status: number } } };
    if (event.method === "Network.requestWillBeSent" && event.params?.request?.url.includes("googlevideo.com")) {
      pageNetReqs.push({ url: event.params.request.url.slice(0, 120), method: event.params.request.method });
    }
    if (event.method === "Network.responseReceived" && event.params?.response?.url.includes("googlevideo.com")) {
      pageNetResps.push({ url: event.params.response.url.slice(0, 80), status: event.params.response.status });
      console.log(`[PAGE NET] ${event.params.response.status} ${event.params.response.url.slice(0, 80)}`);
    }
  });
  await pageSession.send("Network.enable", {});

  // --- Step 4: Interact with downloader ---
  console.log("\n=== STEP 4: Downloader interaction ===");

  const currentBtns = await reval(pageSession,
    "JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(b => b.getAttribute('aria-label') || b.textContent?.trim()).filter(Boolean).slice(0, 20))"
  );
  console.log("Downloader buttons:", currentBtns);

  const stopResult = await reval(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll("[data-ytdl-playlist-downloader] button"));
      const stopBtn = allBtns.find(b => (b.getAttribute("aria-label") || "").toLowerCase().includes("stop") || (b.textContent?.trim() || "").toLowerCase().includes("stop"));
      if (stopBtn) { (stopBtn as HTMLElement).click(); return JSON.stringify({ stopped: true, label: stopBtn.getAttribute("aria-label") || stopBtn.textContent?.trim() }); }
      return JSON.stringify({ noStop: true });
    })()
  `);
  console.log("Stop batch:", stopResult);
  await sleep(1000);

  // Clear checkboxes
  await reval(pageSession, `
    Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label="Select for download"]'))
      .filter(cb => cb.getAttribute("aria-checked") === "true")
      .forEach(cb => { cb.removeAttribute("checked"); cb.setAttribute("aria-checked","false"); cb.dispatchEvent(new Event("change",{bubbles:true})); })
  `);
  await sleep(300);

  // Select item 2
  console.log("\nSelecting item 2...");
  const selectResult = await reval(pageSession, `
    (() => {
      const items = Array.from(document.querySelectorAll("ytd-playlist-video-renderer"));
      const item = items[1];
      if (!item) return JSON.stringify({ error: "not found", count: items.length });
      const cb = item.querySelector('tp-yt-paper-checkbox[aria-label="Select for download"]');
      if (!cb) return JSON.stringify({ error: "no checkbox" });
      (cb as HTMLElement).click();
      return JSON.stringify({ title: item.querySelector("a#video-title")?.textContent?.trim()?.slice(0, 60) });
    })()
  `);
  console.log("Selected:", selectResult);
  await sleep(400);

  const selCount = await reval(pageSession, "document.querySelector('.ytdl-selection-count')?.textContent?.trim()");
  console.log("Selection count:", selCount);

  // Separate files mode
  const separateResult = await reval(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll("[data-ytdl-playlist-downloader] button"));
      const btn = allBtns.find(b => b.getAttribute("aria-label") === "Separate files");
      if (!btn) return JSON.stringify({ notFound: true, btns: allBtns.map(b => b.getAttribute("aria-label")).filter(Boolean).slice(0,15) });
      (btn as HTMLElement).click();
      return JSON.stringify({ clicked: true });
    })()
  `);
  console.log("Separate files mode:", separateResult);
  await sleep(300);

  // Click download
  const dlResult = await reval(pageSession, `
    (() => {
      const allBtns = Array.from(document.querySelectorAll("[data-ytdl-playlist-downloader] button"));
      const btn = allBtns.find(b => {
        const label = b.getAttribute("aria-label") || "";
        return label.toLowerCase().startsWith("download") && !label.toLowerCase().includes("whole");
      });
      if (!btn) return JSON.stringify({ notFound: true, labels: allBtns.map(b => b.getAttribute("aria-label")).filter(Boolean).slice(0,15) });
      (btn as HTMLElement).click();
      return JSON.stringify({ clicked: true, label: btn.getAttribute("aria-label") });
    })()
  `);
  console.log("Download start:", dlResult);

  await sleep(2000);

  // --- Step 5: Find SW and monitor ---
  let swSession: Session | null = null;
  const swNetReqs: Array<{ url: string; method: string }> = [];
  const swNetResps: Array<{ url: string; status: number }> = [];
  const swConsoleLogs: string[] = [];

  const findSw = async (timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const t = await getTargets();
      const sw = t.find(x => x.type === "service_worker" && x.url.includes("iakm"));
      if (sw) return openSession(sw.webSocketDebuggerUrl);
      await sleep(500);
    }
    return null;
  };

  swSession = await findSw();
  console.log("\nSW found:", !!swSession);

  if (swSession) {
    swSession.onEvent((ev: unknown) => {
      const event = ev as { method?: string; params?: Record<string, unknown> };
      if (event.method === "Network.requestWillBeSent") {
        const req = (event.params?.request as { url: string; method: string } | undefined);
        if (req?.url.includes("googlevideo.com")) {
          swNetReqs.push({ url: req.url.slice(0, 120), method: req.method });
          console.log(`[SW REQ] ${req.method} ${req.url.slice(0, 100)}`);
        }
      }
      if (event.method === "Network.responseReceived") {
        const resp = (event.params?.response as { url: string; status: number } | undefined);
        if (resp?.url.includes("googlevideo.com")) {
          swNetResps.push({ url: resp.url.slice(0, 80), status: resp.status });
          console.log(`[SW RESP] ${resp.status} ${resp.url.slice(0, 80)}`);
        }
      }
      if (event.method === "Runtime.consoleAPICalled") {
        const args = (event.params?.args as Array<{ value?: string }> | undefined) ?? [];
        const msg = args.map(a => String(a.value ?? "")).join(" ");
        if (msg.includes("sabr") || msg.includes("SABR") || msg.includes("iframe") || msg.includes("credential") || msg.includes("403") || msg.includes("download") || msg.includes("Download") || msg.includes("error") || msg.includes("Error")) {
          swConsoleLogs.push(msg);
          console.log(`[SW LOG] ${msg.slice(0, 200)}`);
        }
      }
    });
    await swSession.send("Network.enable", {});
    await swSession.send("Runtime.enable", {});

    const storage = await reval(swSession, `
      (async () => { const r = await chrome.storage.local.get(["videoQueue","videoDetails"]); return JSON.stringify({ queueLen: r.videoQueue?.length ?? 0, details: r.videoDetails }); })()
    `, true);
    console.log("\nStorage after start:", storage);
  }

  // --- Step 6: Poll ---
  console.log("\n=== STEP 5: Polling (60s) ===");
  const pollStart = Date.now();
  for (let tick = 0; tick < 30; tick++) {
    await sleep(2000);
    if (!swSession) break;
    const elapsed = Math.round((Date.now() - pollStart) / 1000);

    const state = await reval(swSession, `
      (async () => { const r = await chrome.storage.local.get(["videoQueue","statusProgress"]); return JSON.stringify({ q: r.videoQueue?.length ?? 0, p: r.statusProgress ?? {} }); })()
    `, true);
    const { q, p } = JSON.parse(state) as { q: number; p: Record<string, unknown> };
    console.log(`[${elapsed}s] queue=${q} progress keys=${JSON.stringify(Object.keys(p))}`);
    if (Object.keys(p).length > 0 && tick % 3 === 0) console.log(`  values:`, JSON.stringify(p));
    if (q === 0 && Object.keys(p).length === 0 && tick > 1) {
      console.log("Queue cleared - done");
      break;
    }
  }

  // --- Step 7: Final state ---
  if (swSession) {
    const dlCheck = await reval(swSession, `
      (async () => {
        const dl = await chrome.downloads.search({ limit: 5, orderBy: ["-startTime"] });
        return JSON.stringify(dl.map(d => ({ filename: (d.filename||"").split("\\\\").pop(), state: d.state, fileSize: d.fileSize, error: d.error })));
      })()
    `, true);
    console.log("\nRecent downloads:", dlCheck);
  }

  const states = await reval(pageSession, `
    JSON.stringify([1].map(i => {
      const el = Array.from(document.querySelectorAll("ytd-playlist-video-renderer"))[i];
      return { i, title: el?.querySelector("a#video-title")?.textContent?.trim()?.slice(0,50), state: el?.querySelector("[data-ytdl-download-state]")?.getAttribute("data-ytdl-download-state") };
    }))
  `);
  console.log("Item states:", states);

  console.log("\n=== NETWORK SUMMARY ===");
  console.log(`Page googlevideo requests: ${pageNetReqs.length}`);
  pageNetReqs.forEach(r => console.log(`  ${r.method} ${r.url}`));
  console.log(`Page googlevideo responses: ${pageNetResps.length}`);
  pageNetResps.forEach(r => console.log(`  ${r.status} ${r.url}`));
  console.log(`SW googlevideo requests: ${swNetReqs.length}`);
  swNetReqs.forEach(r => console.log(`  ${r.method} ${r.url}`));
  console.log(`SW googlevideo responses: ${swNetResps.length}`);
  swNetResps.forEach(r => console.log(`  ${r.status} ${r.url}`));
  console.log(`SW console logs captured: ${swConsoleLogs.length}`);

  pageSession.close();
  swSession?.close();
  console.log("\nDone.");
}

main().catch(console.error);
