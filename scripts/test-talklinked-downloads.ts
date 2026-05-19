// Attempt 1: Test bGr3dTK9oAU watch page + first two TalkLinked playlist videos
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const WATCH_VIDEO_ID = "bGr3dTK9oAU";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";
const VIDEO_1 = "ukYofhuBWEM";
const VIDEO_2 = "bGr3dTK9oAU";

function openSession(wsUrl: string): Promise<{
  send: (method: string, params?: object) => Promise<unknown>;
  close: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}> {
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

async function findSwSession(timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const sw = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
    if (sw) return openSession(sw.webSocketDebuggerUrl);
    await sleep(300);
  }
  return null;
}

function attachConsole(session: Awaited<ReturnType<typeof openSession>>, prefix: string, logs: string[]) {
  session.on("Runtime.consoleAPICalled", (params) => {
    const p = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    const msg = p.args.map(a => a.value ?? a.description ?? "").join(" ");
    const str = String(msg);
    if (str.includes("ytdl") || str.includes("SABR") || str.includes("sabr") || str.includes("download") || str.includes("error") || str.includes("Error")) {
      const line = `[${prefix}:${p.type}] ${str.slice(0, 200)}`;
      logs.push(line);
      console.log(line);
    }
  });
}

async function evalPage(session: Awaited<ReturnType<typeof openSession>>, expr: string) {
  const r = await session.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: unknown } };
  return r.result.value;
}

async function testWatchPage(swSession: Awaited<ReturnType<typeof openSession>>, logs: string[]) {
  console.log("\n=== TEST 1: Watch page bGr3dTK9oAU ===");
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;

  // Find or navigate to watch page
  let watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${WATCH_VIDEO_ID}`));
  if (!watchTab) {
    // Use any existing YouTube tab and SPA-navigate
    const ytTab = targets.find(t => t.type === "page" && t.url.includes("youtube.com"));
    if (!ytTab) { console.log("No YouTube tab"); return false; }

    const navSession = await openSession(ytTab.webSocketDebuggerUrl);
    // SPA navigate by clicking history link
    await navSession.send("Runtime.evaluate", {
      expression: `window.location.href = "https://www.youtube.com/watch?v=${WATCH_VIDEO_ID}"`,
      awaitPromise: false
    });
    navSession.close();
    await sleep(5000);

    const targets2 = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    watchTab = targets2.find(t => t.type === "page" && t.url.includes(`v=${WATCH_VIDEO_ID}`));
    if (!watchTab) { console.log("Watch tab not found after navigation"); return false; }
  }

  const watchSession = await openSession(watchTab.webSocketDebuggerUrl);
  await watchSession.send("Runtime.enable");
  attachConsole(watchSession, "PAGE", logs);

  // Check extension download button
  const btnState = await evalPage(watchSession, `(() => {
    const dlBtn = document.querySelector('.ytdl-download-button');
    const topBtns = document.querySelector('#top-level-buttons-computed');
    return JSON.stringify({
      hasDlBtn: !!dlBtn,
      dlBtnTag: dlBtn?.tagName,
      hasTopBtns: !!topBtns
    });
  })()`);
  console.log("Watch page button state:", btnState);

  const state = JSON.parse(String(btnState) || "{}") as { hasDlBtn?: boolean };
  if (!state.hasDlBtn) {
    console.log("No download button found on watch page");
    watchSession.close();
    return false;
  }

  // Click the download button
  await evalPage(watchSession, `(() => {
    const dlBtn = document.querySelector('.ytdl-download-button');
    const inner = dlBtn?.querySelector('button') ?? dlBtn;
    inner?.click();
  })()`);
  console.log("Clicked download button on watch page, waiting 60s...");

  await sleep(60_000);
  watchSession.close();
  return true;
}

async function testPlaylistVideos(swSession: Awaited<ReturnType<typeof openSession>>, logs: string[]) {
  console.log("\n=== TEST 2: TalkLinked playlist first two videos ===");
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const playlistTab = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!playlistTab) {
    console.log("No playlist tab found. URL must contain", PLAYLIST_ID);
    return false;
  }

  const pageSession = await openSession(playlistTab.webSocketDebuggerUrl);
  await pageSession.send("Runtime.enable");
  attachConsole(pageSession, "PLAYLIST", logs);

  const btnCheck = await evalPage(pageSession, `(() => {
    const allBtns = document.querySelectorAll('.ytdl-download-button, [data-ytdl-button-id*="download"]');
    return JSON.stringify({
      count: allBtns.length,
      ids: Array.from(allBtns).slice(0, 5).map(b => b.getAttribute('data-ytdl-button-id') ?? b.className?.slice?.(0, 40))
    });
  })()`);
  console.log("Playlist download buttons:", btnCheck);

  // Click VIDEO_1 download
  const click1 = await evalPage(pageSession, `(() => {
    const btn = document.querySelector('[data-ytdl-button-id="btn-${VIDEO_1}-download"]');
    const inner = btn?.querySelector('button') ?? btn;
    if (inner) { inner.click(); return 'clicked ${VIDEO_1}'; }
    // Fallback: find by video item
    const items = document.querySelectorAll('ytd-playlist-video-renderer');
    for (const item of items) {
      if (item.innerHTML.includes('${VIDEO_1}')) {
        const dlBtn = item.querySelector('.ytdl-download-button button, [data-ytdl-button-id*="download"] button');
        if (dlBtn) { dlBtn.click(); return 'clicked via item ${VIDEO_1}'; }
      }
    }
    return 'not found ${VIDEO_1}';
  })()`);
  console.log("Click 1:", click1);
  await sleep(3000);

  // Click VIDEO_2 download
  const click2 = await evalPage(pageSession, `(() => {
    const btn = document.querySelector('[data-ytdl-button-id="btn-${VIDEO_2}-download"]');
    const inner = btn?.querySelector('button') ?? btn;
    if (inner) { inner.click(); return 'clicked ${VIDEO_2}'; }
    return 'not found ${VIDEO_2}';
  })()`);
  console.log("Click 2:", click2);

  console.log("Waiting 90s for playlist downloads...");
  await sleep(90_000);
  pageSession.close();
  return true;
}

async function main() {
  const swSession = await findSwSession();
  if (!swSession) { console.error("Service worker not found at", CDP_URL); process.exit(1); }

  await swSession.send("Runtime.enable");
  const logs: string[] = [];
  attachConsole(swSession, "SW", logs);

  console.log("SW connected, starting tests...\n");

  await testWatchPage(swSession, logs);
  await testPlaylistVideos(swSession, logs);

  console.log("\n=== SUMMARY of all logs ===");
  for (const log of logs) console.log(log);

  swSession.close();
}

main().catch(console.error);
