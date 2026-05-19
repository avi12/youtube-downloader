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

async function eval_(session: Awaited<ReturnType<typeof openSession>>, expression: string) {
  const r = await session.send("Runtime.evaluate", { expression, awaitPromise: false, returnByValue: true }) as { result: { value: unknown } };
  return r.result.value;
}

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!page) { console.error("Playlist tab not found"); return; }

  const pageSession = await openSession(page.webSocketDebuggerUrl);

  const states = await eval_(pageSession, `
    JSON.stringify(Array.from(document.querySelectorAll('ytd-playlist-video-renderer')).slice(0, 5).map((el, i) => {
      const title = el.querySelector('a#video-title')?.textContent?.trim()?.slice(0, 50);
      const stateEl = el.querySelector('[data-ytdl-download-state]');
      const downloadState = stateEl?.getAttribute('data-ytdl-download-state');
      const btnLabels = Array.from(el.querySelectorAll('button[aria-label]')).map(b => b.getAttribute('aria-label')).filter(Boolean);
      return { i, title, downloadState, btnLabels };
    }))
  `);
  console.log("Item states:", JSON.stringify(JSON.parse(states as string), null, 2));

  pageSession.close();
}

main().catch(console.error);
