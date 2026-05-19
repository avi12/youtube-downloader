// Check if SABR data has been captured for any YouTube tab
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  return new Promise((resolve, reject) => {
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
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const h = pending.get(msg.id);
        if (h) { pending.delete(msg.id); msg.error ? h.reject(msg.error) : h.resolve(msg.result); }
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

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!swTarget) { console.error("SW not found"); return; }

  const swSession = await openSession(swTarget.webSocketDebuggerUrl);

  // Check if any SABR data was captured for the watch tab
  const tabCheck = await swEval(swSession, `
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/watch?v=${VIDEO_ID}*' });
    if (!tabs.length) return JSON.stringify({ error: 'tab not found' });
    const tabId = tabs[0].id;
    // Try to get captured SABR body for this tab
    // The capturedByTab is module-level state we can't access directly from eval
    // But we can send a GetCapturedSabrBody message from context of that tab
    return JSON.stringify({ tabId, tabUrl: tabs[0].url });
  `);
  console.log("Tab info:", tabCheck);

  // Check capturedByTab state (indirect: try sending message from SW context)
  const captureResult = await swEval(swSession, `
    // Access the capturedByTab map via a dummy message to trigger the handler
    // We need to check if there's a captured SABR request for ukYofhuBWEM
    // The capturedByTab is in request-capture.ts module scope
    // Let's try accessing it via the global scope if exported
    return JSON.stringify({ canAccess: typeof capturedByTab !== 'undefined' });
  `);
  console.log("Capture access:", captureResult);

  // Wait for more buffering and check player state
  await sleep(3000);

  const watchTarget = (await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>)
    .find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!watchTarget) { swSession.close(); return; }

  const watchSession = await openSession(watchTarget.webSocketDebuggerUrl);
  const playerState = await watchSession.send("Runtime.evaluate", {
    expression: `(() => {
      const video = document.querySelector('video');
      return JSON.stringify({
        networkState: video?.networkState,
        buffered: video?.buffered?.length > 0 ? video.buffered.end(video.buffered.length-1) : 0,
        currentTime: video?.currentTime,
        readyState: video?.readyState
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Player state:", playerState.result.value);

  watchSession.close();
  swSession.close();
}

main().catch(console.error);
