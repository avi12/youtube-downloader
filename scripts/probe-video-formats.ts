// Navigate to ukYofhuBWEM watch page and extract available format URLs
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

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
  // Use the jqu3rVvZTiY watch page tab (it exists from previous session)
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  let watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));

  if (!watchTab) {
    // Navigate the existing watch tab
    watchTab = targets.find(t => t.type === "page" && t.url.includes("watch?v="));
    if (!watchTab) { console.error("No watch tab found"); return; }
    console.log("Navigating to", VIDEO_ID);
    const sess = await openSession(watchTab.webSocketDebuggerUrl);
    await sess.send("Page.navigate", { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
    await sleep(4000);
    sess.close();

    const targets2 = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    watchTab = targets2.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
    if (!watchTab) { console.error("Watch tab not found after nav"); return; }
  }

  const pageSession = await openSession(watchTab.webSocketDebuggerUrl);

  // Check ytInitialPlayerResponse for format data
  const result = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      try {
        const data = ytInitialPlayerResponse;
        if (!data) return JSON.stringify({ error: 'no ytInitialPlayerResponse' });
        const formats = data.streamingData?.adaptiveFormats ?? [];
        const sample = formats.slice(0, 3).map(f => ({
          itag: f.itag,
          mimeType: f.mimeType,
          hasUrl: !!f.url,
          hasSig: !!f.signatureCipher,
          hasBoth: !!f.url && !!f.signatureCipher,
          urlStart: f.url?.slice(0, 80) ?? null
        }));
        return JSON.stringify({ formatCount: formats.length, sample, hasSabrConfig: !!(data.streamingData?.serverAbrStreamingUrl) });
      } catch(e) { return JSON.stringify({ error: e?.message }); }
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Format data:", result.result.value);

  pageSession.close();
}

main().catch(console.error);
