import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const TALKINKED_LIST = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

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

async function swEval(session: Awaited<ReturnType<typeof openSession>>, expression: string) {
  const r = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  return r.result.value;
}

async function main() {
  const res = await fetch(`${CDP_URL}/json`);
  const targets = await res.json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const sw = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  const page = targets.find(t => t.type === "page" && t.url.includes(TALKINKED_LIST));
  if (!sw) { console.error("SW not found"); return; }

  const pageSession = page ? await openSession(page.webSocketDebuggerUrl) : null;
  const swSession = await openSession(sw.webSocketDebuggerUrl);
  await sleep(200);

  const storage = await swEval(swSession, `(async () => {
    const s = await chrome.storage.local.get(null);
    return JSON.stringify({ keys: Object.keys(s), interrupted: s.interruptedDownloads, checkedVideos: s["ytdl-checked-playlist-videos"] }, null, 2);
  })()`);
  console.log("Storage:", storage);

  // Check recent downloads via IndexedDB
  const recentCheck = await (pageSession ?? swSession).send("Runtime.evaluate", {
    expression: `(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open("ytdl-recent-downloads");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("downloads", "readonly");
          const store = tx.objectStore("downloads");
          const all = store.getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result?.map(r => ({ id: r.id, filename: r.filename, videoId: r.videoId })) || []));
          all.onerror = () => resolve(JSON.stringify({ error: "getAll failed" }));
        };
        req.onerror = () => resolve(JSON.stringify({ error: "open failed" }));
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("\nRecent downloads IndexedDB:", recentCheck.result.value);

  pageSession?.close();
  swSession.close();
}

main().catch(console.error);
