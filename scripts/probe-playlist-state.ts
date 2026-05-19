// Check the playlist downloader's actual reactive state
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
  const pageTarget = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!pageTarget) { console.error("Playlist tab not found"); return; }

  const pageSession = await openSession(pageTarget.webSocketDebuggerUrl);

  // Get downloader panel element and its svelte/reactive properties
  const result = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const panel = document.querySelector('[data-ytdl-playlist-downloader]');
      if (!panel) return 'no panel';

      // Get all buttons with their visual state
      const allBtns = Array.from(panel.querySelectorAll('button, tp-yt-paper-button'));
      const btnStates = allBtns.map(b => {
        const styles = window.getComputedStyle(b);
        const bgColor = styles.backgroundColor;
        const color = styles.color;
        const fontWeight = styles.fontWeight;
        return {
          label: (b.getAttribute('aria-label') || b.textContent?.trim() || '').slice(0, 40),
          bg: bgColor,
          weight: fontWeight,
          selected: b.classList.contains('selected') || b.hasAttribute('active') || b.getAttribute('aria-selected') === 'true' || (b.getAttribute('aria-pressed') === 'true') || b.classList.contains('active')
        };
      }).filter(b => b.label);

      // Also look for data attributes on the panel
      const panelDatasets = JSON.stringify(Object.fromEntries(
        Object.entries(panel.dataset).slice(0, 20)
      ));

      return JSON.stringify({ btnStates, panelDatasets });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };

  const { btnStates, panelDatasets } = JSON.parse(result.result.value) as {
    btnStates: Array<{ label: string; bg: string; weight: string; selected: boolean }>;
    panelDatasets: string;
  };

  console.log("Panel datasets:", panelDatasets);
  console.log("\nButton states:");
  for (const btn of btnStates) {
    const marker = btn.selected ? " [SELECTED]" : "";
    console.log(`  ${btn.label.padEnd(30)} bg=${btn.bg.slice(0,30)}  weight=${btn.weight}${marker}`);
  }

  pageSession.close();
}

main().catch(console.error);
