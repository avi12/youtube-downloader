import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "bGr3dTK9oAU";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    ws.on("open", () => {
      resolve({
        send(method: string, params: object = {}) {
          return new Promise((res, rej) => {
            const id = msgId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); }
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
      }
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  let watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));

  if (!watchTab) {
    watchTab = targets.find(t => t.type === "page" && t.url.includes("watch?v="));
    if (!watchTab) { console.error("No watch tab found"); return; }
    const sess = await openSession(watchTab.webSocketDebuggerUrl);
    await sess.send("Page.navigate", { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
    await sleep(4000);
    sess.close();

    const targets2 = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    watchTab = targets2.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
    if (!watchTab) { console.error("Watch tab not found after nav"); return; }
  }

  const pageSession = await openSession(watchTab.webSocketDebuggerUrl);
  const result = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const data = ytInitialPlayerResponse;
      if (!data) return JSON.stringify({ error: 'no ytInitialPlayerResponse' });
      const formats = data.streamingData?.adaptiveFormats ?? [];
      const sample = formats.slice(0, 5).map(f => ({
        itag: f.itag,
        mimeType: f.mimeType?.slice(0, 40),
        hasUrl: !!f.url,
        hasSig: !!f.signatureCipher
      }));
      return JSON.stringify({ formatCount: formats.length, sample, hasSabr: !!(data.streamingData?.serverAbrStreamingUrl) });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("bGr3dTK9oAU format data:", result.result.value);
  pageSession.close();
}

main().catch(console.error);
