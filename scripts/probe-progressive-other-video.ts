// Test progressive URL from bGr3dTK9oAU which downloads fine via adaptive
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

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

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function testVideo(videoId: string, tabSession: Awaited<ReturnType<typeof openSession>>) {
  // Navigate to this video
  await tabSession.send("Page.navigate", { url: `https://www.youtube.com/watch?v=${videoId}` });
  await sleep(4000);

  const result = await tabSession.send("Runtime.evaluate", {
    expression: `(async () => {
      const pr = window.ytInitialPlayerResponse;
      if (!pr?.streamingData) return JSON.stringify({ error: 'no streamingData' });
      const formats = pr.streamingData.formats ?? [];
      const sp = formats.find(f => f.itag === 18 && f.url);
      if (!sp?.url) return JSON.stringify({ error: 'no progressive url', formatsCount: formats.length });

      const resp = await fetch(sp.url, { method: 'HEAD', credentials: 'include' });
      return JSON.stringify({
        status: resp.status,
        ok: resp.ok,
        urlSlice: sp.url.slice(0, 60),
        hasSefc: sp.url.includes('sefc=1'),
        hasSpc: sp.url.includes('spc='),
        clientParam: sp.url.match(/[&?]c=([^&]+)/)?.[1] ?? null
      });
    })()`,
    awaitPromise: true,
    returnByValue: true,
    timeout: 10000
  }) as { result: { value: string } };

  console.log(`Video ${videoId}:`, JSON.parse(result.result.value));
}

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const ytTab = targets.find(tab => tab.type === "page" && tab.url.includes("youtube.com"));
  if (!ytTab) { console.error("No YouTube tab"); return; }

  const session = await openSession(ytTab.webSocketDebuggerUrl);

  // Test another video that downloads fine
  await testVideo("bGr3dTK9oAU", session);

  session.close();
}

main().catch(console.error);
