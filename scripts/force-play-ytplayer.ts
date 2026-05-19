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

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) { console.error("Watch tab not found"); return; }

  const session = await openSession(watchTab.webSocketDebuggerUrl);

  await session.send("Network.enable", {});
  let gotNetworkEvent = false;
  session.on("Network.requestWillBeSent", (params) => {
    const p = params as { request: { url: string } };
    if (p.request.url.includes("googlevideo")) {
      gotNetworkEvent = true;
      console.log("  NET SABR:", p.request.url.slice(0, 100));
    }
  });
  session.on("Network.responseReceived", (params) => {
    const p = params as { response: { url: string; status: number; headers: Record<string, string> } };
    if (p.response.url.includes("googlevideo")) {
      const ct = p.response.headers["content-type"] || p.response.headers["Content-Type"] || "";
      console.log("  NET RESP:", p.response.status, ct.slice(0,30), p.response.url.slice(0, 80));
    }
  });

  // Try to activate the player using YouTube's APIs
  const activateResult = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const player = document.querySelector('#movie_player');
      if (!player) return 'no player';
      // Try YouTube player API
      const results = [];
      if (typeof player.playVideo === 'function') {
        player.playVideo();
        results.push('playVideo()');
      }
      if (typeof player.unMute === 'function') {
        player.unMute();
      }
      // Dispatch click event on the play button
      const ytp = document.querySelector('.ytp-play-button');
      if (ytp) {
        ytp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        results.push('clicked ytp-play-button');
      }
      // Try the large play button
      const largePb = document.querySelector('.ytp-large-play-button');
      if (largePb) {
        largePb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        results.push('clicked large play button');
      }
      return JSON.stringify({ results, playerState: player.getPlayerState?.() });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Activate result:", activateResult.result.value);

  console.log("Waiting 8s for buffering...");
  await sleep(8000);

  const playerState = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const v = document.querySelector('video');
      const player = document.querySelector('#movie_player');
      return JSON.stringify({
        ns: v?.networkState,
        rs: v?.readyState,
        buf: v?.buffered?.length > 0 ? v.buffered.end(v.buffered.length-1) : 0,
        ct: v?.currentTime,
        playerState: player?.getPlayerState?.(),
        gotNetworkEvent: ${gotNetworkEvent}
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Player state:", playerState.result.value);
  console.log("Got network events:", gotNetworkEvent);

  session.close();
}

main().catch(console.error);
