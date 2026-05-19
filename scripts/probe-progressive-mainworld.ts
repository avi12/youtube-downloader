// Probe: does a fetch({ credentials: "include" }) from the main YouTube page
// context succeed for ukYofhuBWEM's fresh progressive URL?
// Run this while the watch tab for ukYofhuBWEM is open.
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

function openSession(wsUrl: string) {
  return new Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }>((resolve, reject) => {
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
        const handler = pending.get(msg.id);
        if (handler) { pending.delete(msg.id); msg.error ? handler.reject(msg.error) : handler.resolve(msg.result); }
      }
    });
    ws.on("error", reject);
  });
}

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const watchTab = targets.find(tab => tab.type === "page" && tab.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) { console.error("No watch tab for", VIDEO_ID); return; }

  console.log("Found watch tab:", watchTab.url);
  const session = await openSession(watchTab.webSocketDebuggerUrl);

  const result = await session.send("Runtime.evaluate", {
    expression: `(async () => {
      const pr = window.ytInitialPlayerResponse;
      const formats = pr?.streamingData?.formats ?? [];
      const itag18 = formats.find(f => f.itag === 18 && f.url);
      if (!itag18?.url) return JSON.stringify({ error: 'no url', count: formats.length });

      const url = itag18.url;
      const expireMatch = url.match(/expire=(\d+)/);
      const expire = expireMatch ? parseInt(expireMatch[1]) : 0;
      const now = Date.now() / 1000;
      const secondsLeft = expire - now;

      try {
        const resp = await fetch(url, { credentials: "include" });
        const textOrBytes = resp.ok ? (await resp.blob()).size : await resp.text().then(t => t.slice(0, 200));
        return JSON.stringify({
          status: resp.status,
          ok: resp.ok,
          secondsUntilExpiry: Math.floor(secondsLeft),
          contentType: resp.headers.get('content-type'),
          result: textOrBytes
        });
      } catch (e) {
        return JSON.stringify({ error: String(e), secondsUntilExpiry: Math.floor(secondsLeft) });
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
    timeout: 60000
  }) as { result: { value: string } };

  console.log("Result:", JSON.parse(result.result.value));
  session.close();
}

main().catch(console.error);
