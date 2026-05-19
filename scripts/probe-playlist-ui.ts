// Inspect the TalkLinked playlist page for the extension's download UI
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

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string; id: string; title: string }>;
  const tab = targets.find(t => t.type === "page" && t.url.includes("PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa"));
  if (!tab) { console.error("No TalkLinked tab"); return; }

  const session = await openSession(tab.webSocketDebuggerUrl);

  const result = await session.send("Runtime.evaluate", {
    expression: `(() => {
      // Find all ytdl-related elements on the playlist page
      const all = document.querySelectorAll('[class*="ytdl"],[id*="ytdl"]');
      const byTag = {};
      for (const el of all) {
        const key = el.tagName + '.' + el.className.trim().slice(0, 60);
        byTag[key] = (byTag[key] || 0) + 1;
      }

      // Also look for buttons with specific aria labels or attributes
      const downloadButtons = document.querySelectorAll('button[aria-label*="ownload"], button[title*="ownload"]');

      // Look for ytdl-specific wrapper
      const ytdlWrappers = document.querySelectorAll('#ytdl-playlist-downloader, .ytdl-playlist, ytdl-playlist-downloader-panel');

      return JSON.stringify({
        ytdlElements: Object.keys(byTag).slice(0, 20),
        downloadButtonCount: downloadButtons.length,
        downloadButtonLabels: Array.from(downloadButtons).slice(0, 5).map(b => b.getAttribute('aria-label')),
        wrapperCount: ytdlWrappers.length,
        bodyClasses: document.body.className.slice(0, 100)
      });
    })()`,
    returnByValue: true
  }) as { result: { value: string } };

  console.log(JSON.parse(result.result.value));
  session.close();
}

main().catch(console.error);
