// Test if progressive URL is fetchable from within the YouTube page context
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
  if (!watchTab) {
    console.error("No watch tab for", VIDEO_ID);
    return;
  }

  const session = await openSession(watchTab.webSocketDebuggerUrl);

  // Test fetch from within the YouTube page context (has cookies + Origin)
  const result = await session.send("Runtime.evaluate", {
    expression: `(async () => {
      const pr = window.ytInitialPlayerResponse;
      const formats = pr?.streamingData?.formats ?? [];
      const itag18 = formats.find(f => f.itag === 18 && f.url);
      if (!itag18?.url) return JSON.stringify({ error: 'no url' });

      try {
        const resp = await fetch(itag18.url, { method: 'HEAD', credentials: 'include' });
        return JSON.stringify({
          status: resp.status,
          ok: resp.ok,
          contentType: resp.headers.get('content-type'),
          contentLength: resp.headers.get('content-length')
        });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };

  console.log("From YouTube page context:", result.result.value);

  session.close();
}

main().catch(console.error);
