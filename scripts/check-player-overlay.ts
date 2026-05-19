import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

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
  const watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) { console.error("Watch tab not found"); return; }

  const session = await openSession(watchTab.webSocketDebuggerUrl);

  const result = await session.send("Runtime.evaluate", {
    expression: `(() => {
      // Check for overlays/blockers
      const overlays = Array.from(document.querySelectorAll('.ytp-ad-module, .ytp-error, .ytp-offline-slate, [class*="age-gate"], [class*="consent"], .ytp-modal-dialog')).map(el => ({
        class: el.className?.slice(0, 60),
        visible: !!(el.offsetParent || el.style.display !== 'none'),
        text: el.textContent?.trim()?.slice(0, 100)
      }));

      // Check player specific state
      const player = document.querySelector('#movie_player');
      const errDisplay = document.querySelector('.ytp-error');

      // Player data source - what's in the config?
      let configDetails = null;
      try {
        const appEl = document.querySelector('ytd-app');
        const data = appEl?.data;
        configDetails = data ? 'has-data' : 'no-data';
      } catch(e) {}

      return JSON.stringify({
        overlays: overlays.filter(o => o.visible),
        hasPlayerEl: !!player,
        hasErrDisplay: !!errDisplay,
        errText: errDisplay?.textContent?.trim()?.slice(0, 100),
        configDetails
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Overlay check:", result.result.value);

  session.close();
}

main().catch(console.error);
