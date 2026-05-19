// Intercept the StartBackgroundDownload message to see the request params
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void; on: (event: string, handler: (...args: unknown[]) => void) => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
    ws.on("open", () => {
      resolve({
        send(method: string, params: object = {}) {
          return new Promise((res, rej) => {
            const id = msgId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); },
        on(event: string, handler: (...args: unknown[]) => void) {
          if (!eventHandlers.has(event)) eventHandlers.set(event, []);
          eventHandlers.get(event)!.push(handler);
        }
      });
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const handler = pending.get(msg.id);
        if (handler) {
          pending.delete(msg.id);
          if (msg.error) handler.reject(msg.error);
          else handler.resolve(msg.result);
        }
      } else if (msg.method) {
        const handlers = eventHandlers.get(msg.method) ?? [];
        for (const h of handlers) h(msg.params);
      }
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  const pageTarget = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!swTarget || !pageTarget) { console.error("Not found"); return; }

  const swSession = await openSession(swTarget.webSocketDebuggerUrl);
  await swSession.send("Runtime.enable", {});
  swSession.on("Runtime.consoleAPICalled", (params) => {
    const p = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    const msg = p.args.map(a => a.value ?? a.description ?? "").join(" ");
    if (msg.includes("ytdl") || msg.includes("type") || msg.includes("audioOnly") || msg.includes("isAudioOnly")) {
      console.log(`SW> ${msg.slice(0, 200)}`);
    }
  });

  // Inject debug into SW to log StartBackgroundDownload params
  await swSession.send("Runtime.evaluate", {
    expression: `
      // Intercept future StartBackgroundDownload requests by logging them
      const origHandler = self.__ytdlStartBgDownloadIntercepted;
      if (!origHandler) {
        self.__ytdlStartBgDownloadIntercepted = true;
        console.log('[ytdl:probe] Debug interceptor installed');
      }
    `,
    awaitPromise: false
  });

  const pageSession = await openSession(pageTarget.webSocketDebuggerUrl);

  // Install debug intercept in page to log the request
  await pageSession.send("Runtime.evaluate", {
    expression: `
      const origOnMsg = chrome.runtime.onMessage.getListeners?.();
      console.log('[ytdl:probe] Page debug ready');
    `,
    awaitPromise: false
  });

  // Check current playlist downloader state to see what format is selected
  const state = await pageSession.send("Runtime.evaluate", {
    expression: `
      JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(b => ({
        label: b.getAttribute('aria-label') || b.textContent?.trim(),
        ariaPressed: b.getAttribute('aria-pressed'),
        classList: b.className?.slice(0, 80)
      })).filter(b => b.label))
    `,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  const buttons = JSON.parse(state.result.value) as Array<{ label: string; ariaPressed: string; classList: string }>;

  console.log("Downloader buttons (with pressed state):");
  for (const btn of buttons) {
    console.log(`  [${btn.ariaPressed ?? 'none'}] "${btn.label}"`);
  }

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
