import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

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

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const sw = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!sw) { console.error("SW not found"); return; }

  const swSession = await openSession(sw.webSocketDebuggerUrl);
  const r = await swSession.send("Runtime.evaluate", {
    expression: `(async () => {
      const dl = await chrome.downloads.search({ filenameContains: 'China', limit: 5 });
      return JSON.stringify(dl.map(d => ({
        filename: (d.filename||'').split('\\\\').pop(),
        state: d.state,
        fileSize: d.fileSize,
        error: d.error,
        startTime: d.startTime
      })));
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("China search:", r.result.value);

  const r2 = await swSession.send("Runtime.evaluate", {
    expression: `(async () => {
      const dl = await chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] });
      return JSON.stringify(dl.map(d => ({
        filename: (d.filename||'').split('\\\\').pop(),
        state: d.state,
        fileSize: d.fileSize,
        error: d.error,
        startTime: d.startTime
      })));
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  const items = JSON.parse(r2.result.value) as Array<{ filename: string; state: string; fileSize: number; error: string; startTime: string }>;
  console.log("\nAll recent (sorted by startTime):");
  for (const d of items) {
    console.log(`  ${d.startTime} ${d.state.padEnd(12)} ${(d.fileSize??0).toString().padStart(12)}  ${d.filename}${d.error ? ' ['+d.error+']' : ''}`);
  }
  swSession.close();
}

main().catch(console.error);
