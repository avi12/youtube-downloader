import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

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
  const page = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!page) { console.error("Playlist tab not found"); return; }

  const pageSession = await openSession(page.webSocketDebuggerUrl);

  const result = await pageSession.send("Runtime.evaluate", {
    expression: `JSON.stringify(Array.from(document.querySelectorAll('ytd-playlist-video-renderer')).slice(0, 5).map((el, i) => {
      const title = el.querySelector('a#video-title')?.textContent?.trim()?.slice(0, 50);
      const duration = el.querySelector('span.ytd-thumbnail-overlay-time-status-renderer')?.textContent?.trim();
      const videoId = el.querySelector('a#video-title')?.href?.match(/v=([^&]+)/)?.[1];
      return { i, title, duration, videoId };
    }))`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  const items = JSON.parse(result.result.value) as Array<{ i: number; title: string; duration: string; videoId: string }>;
  for (const item of items) {
    console.log(`[${item.i}] ${item.videoId}  ${(item.duration || '?').padStart(8)}  ${item.title}`);
  }

  pageSession.close();
}

main().catch(console.error);
