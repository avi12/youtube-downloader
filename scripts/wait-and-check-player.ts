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

  // Enable network events
  await session.send("Network.enable", {});
  const networkEvents: Array<{ type: string; url: string; status?: number }> = [];
  session.on("Network.requestWillBeSent", (params) => {
    const p = params as { request: { url: string } };
    if (p.request.url.includes("googlevideo") || p.request.url.includes("videoplayback")) {
      networkEvents.push({ type: "request", url: p.request.url.slice(0, 100) });
      console.log("  NET> Request:", p.request.url.slice(0, 100));
    }
  });
  session.on("Network.responseReceived", (params) => {
    const p = params as { response: { url: string; status: number; headers: Record<string, string> } };
    if (p.response.url.includes("googlevideo") || p.response.url.includes("videoplayback")) {
      networkEvents.push({ type: "response", url: p.response.url.slice(0, 100), status: p.response.status });
      const ct = p.response.headers["content-type"] || p.response.headers["Content-Type"] || "";
      console.log("  NET> Response:", p.response.status, ct.slice(0,40), p.response.url.slice(0, 80));
    }
  });

  // Wait 10 seconds for network activity
  console.log("Monitoring network for 10s...");
  await sleep(10000);

  // Check player state
  const playerState = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const v = document.querySelector('video');
      const player = document.querySelector('#movie_player');
      return JSON.stringify({
        ns: v?.networkState,
        rs: v?.readyState,
        buf: v?.buffered?.length > 0 ? v.buffered.end(v.buffered.length-1) : 0,
        ct: v?.currentTime,
        errCode: v?.error?.code,
        playerErr: player?.getPlayerState?.()
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("\nPlayer state:", playerState.result.value);
  console.log("Network events:", networkEvents.length);

  session.close();
}

main().catch(console.error);
