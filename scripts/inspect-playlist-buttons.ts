// Inspect what buttons exist on the playlist page
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  return new Promise((resolve, reject) => {
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
        const h = pending.get(msg.id);
        if (h) { pending.delete(msg.id); msg.error ? h.reject(msg.error) : h.resolve(msg.result); }
      }
    });
    ws.on("error", reject);
  });
}

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;

  console.log("All page tabs:");
  targets.filter(t => t.type === "page").forEach(t => console.log(" ", t.url.slice(0, 100)));

  const playlistTab = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!playlistTab) {
    console.log("\nNo playlist tab. Looking for youtube watch tabs:");
    targets.filter(t => t.type === "page" && t.url.includes("youtube.com")).forEach(t =>
      console.log(" ", t.url.slice(0, 120))
    );
    return;
  }

  console.log("\nPlaylist tab URL:", playlistTab.url);
  const session = await openSession(playlistTab.webSocketDebuggerUrl);

  const result = await session.send("Runtime.evaluate", {
    expression: `(() => {
      // All ytdl elements
      const ytdlEls = Array.from(document.querySelectorAll('[class*="ytdl"], [data-ytdl], [id*="ytdl"]'));
      const ytdlClasses = [...new Set(ytdlEls.map(el => el.className?.slice?.(0, 60) ?? el.id))].slice(0, 20);

      // Specifically download buttons by data attr
      const dataAttrs = Array.from(document.querySelectorAll('[data-ytdl-button-id]'))
        .map(el => ({ id: el.getAttribute('data-ytdl-button-id'), tag: el.tagName }))
        .slice(0, 10);

      // Playlist video renderers
      const renderers = document.querySelectorAll('ytd-playlist-video-renderer');

      // Check first renderer for extension UI
      const firstRenderer = renderers[0];
      const firstEl = firstRenderer?.innerHTML?.slice?.(0, 400);

      return JSON.stringify({
        ytdlClassCount: ytdlEls.length,
        ytdlClasses,
        dataAttrButtons: dataAttrs,
        rendererCount: renderers.length,
        firstRendererSnippet: firstEl?.slice(0, 400)
      }, null, 2);
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };

  console.log("\nDOM inspection:", result.result.value);
  session.close();
}

main().catch(console.error);
