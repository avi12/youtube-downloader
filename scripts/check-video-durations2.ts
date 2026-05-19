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

  // Get all text content from first item to see duration element
  const result = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const item = document.querySelectorAll('ytd-playlist-video-renderer')[0];
      if (!item) return 'no item';
      // Try various duration selectors
      const selectors = [
        'span.ytd-thumbnail-overlay-time-status-renderer',
        '[aria-label*=":"]',
        '.badge-shape-wiz__text',
        'ytd-thumbnail-overlay-time-status-renderer',
        '.ytd-thumbnail-overlay-resume-playback-renderer',
        '#overlays span',
        'span[class*="time"]',
        '[class*="duration"]'
      ];
      const found = {};
      for (const sel of selectors) {
        const el = item.querySelector(sel);
        if (el) found[sel] = el.textContent?.trim() || el.getAttribute('aria-label');
      }
      // Also dump all spans
      const spans = Array.from(item.querySelectorAll('span')).map(s => ({
        class: s.className?.slice(0,50),
        text: s.textContent?.trim()?.slice(0,30)
      })).filter(s => s.text).slice(0, 20);
      return JSON.stringify({ found, spans });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Duration check:", result.result.value);

  pageSession.close();
}

main().catch(console.error);
