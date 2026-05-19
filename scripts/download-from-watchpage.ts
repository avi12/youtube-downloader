// Navigate to ukYofhuBWEM watch page, wait for player, then trigger download via the extension button
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
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

  // Use the bGr3dTK9oAU watch tab, navigate it to ukYofhuBWEM
  const watchTab = targets.find(t => t.type === "page" && t.url.includes("watch?v="));
  if (!watchTab) { console.error("No watch tab"); return; }

  console.log("Navigating to", VIDEO_ID, "watch page...");
  const pageSession = await openSession(watchTab.webSocketDebuggerUrl);
  await pageSession.send("Page.navigate", { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });

  // Wait for page load and player initialization
  await sleep(5000);

  const targets2 = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const newWatchTab = targets2.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!newWatchTab) { console.error("Watch tab not found after nav"); return; }

  const watchSession = await openSession(newWatchTab.webSocketDebuggerUrl);

  // Install SW logging
  const swSession = await findSwSession();
  if (swSession) {
    await swSession.send("Runtime.enable", {});
    swSession.on("Runtime.consoleAPICalled", (params) => {
      const p = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
      const msg = p.args.map(a => a.value ?? a.description ?? "").join(" ");
      if (msg.includes("ytdl") || msg.includes("attest") || msg.includes("SABR") || msg.includes("sabr")) {
        console.log(`  SW> ${msg.slice(0, 150)}`);
      }
    });
  }

  // Check player state
  const playerState = await watchSession.send("Runtime.evaluate", {
    expression: `(() => {
      const video = document.querySelector('video');
      return JSON.stringify({
        currentTime: video?.currentTime,
        paused: video?.paused,
        bufferedEnd: video?.buffered?.length > 0 ? video.buffered.end(video.buffered.length - 1) : 0,
        error: video?.error?.code,
        networkState: video?.networkState,
        videoWidth: video?.videoWidth
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Player state:", playerState.result.value);

  // Check if extension has captured SABR data for this tab
  if (swSession) {
    const capturedCheck = await swEval(swSession, `
      const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
      const watchTab = tabs.find(t => t.url?.includes('${VIDEO_ID}'));
      if (!watchTab) return JSON.stringify({ error: 'tab not found in chrome.tabs' });
      const tabId = watchTab.id;
      // Get captured SABR data via message
      return JSON.stringify({ tabId });
    `);
    console.log("Tab check:", capturedCheck);
  }

  // Try to start the player
  await watchSession.send("Runtime.evaluate", {
    expression: `
      const video = document.querySelector('video');
      if (video && video.paused) video.play().catch(e => {});
    `,
    awaitPromise: false
  });
  await sleep(3000);

  // Click the extension download button (video+audio) to initiate download
  console.log("\nLooking for download button...");
  const btnResult = await watchSession.send("Runtime.evaluate", {
    expression: `(() => {
      // Find extension download button
      const btn = document.querySelector('.ytdl-download-btn, [data-ytdl-download], button[aria-label*="Download"]');
      if (!btn) {
        // Try to find by class pattern
        const allBtns = Array.from(document.querySelectorAll('button'));
        const dlBtn = allBtns.find(b => b.className.includes('ytdl') || (b.getAttribute('aria-label')||'').includes('Download'));
        if (!dlBtn) return JSON.stringify({ error: 'no download btn', count: allBtns.length });
        return JSON.stringify({ found: true, label: dlBtn.getAttribute('aria-label'), class: dlBtn.className.slice(0,80) });
      }
      return JSON.stringify({ found: true, label: btn.getAttribute('aria-label') });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Download button search:", btnResult.result.value);

  watchSession.close();
  pageSession.close();
  swSession?.close();
}

main().catch(console.error);
