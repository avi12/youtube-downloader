import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

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

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const sw = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!sw) { console.error("SW not found"); return; }

  const swSession = await openSession(sw.webSocketDebuggerUrl);

  const logs: string[] = [];
  swSession.on("Runtime.consoleAPICalled", (params) => {
    const p = params as { type: string; args: Array<{ value?: unknown; description?: string }> };
    const msg = p.args.map(a => a.value ?? a.description ?? "").join(" ");
    if (msg.includes("ytdl") || msg.includes("download") || msg.includes("China") || msg.includes("failed") || msg.includes("error") || msg.includes("sabr") || msg.includes("SABR")) {
      logs.push(`[${p.type}] ${msg}`);
    }
  });

  await swSession.send("Runtime.enable", {});

  // Retry the failed video
  const targets2 = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const page = targets2.find(t => t.type === "page" && t.url.includes("PL3zIYvF1XjLm5mHJu"));
  if (!page) { console.error("No playlist tab"); swSession.close(); return; }

  const pageSession = await openSession(page.webSocketDebuggerUrl);

  // Click retry on video 0
  const retryResult = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const items = Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));
      const item = items[0];
      if (!item) return 'no item';
      const btn = item.querySelector('button[aria-label*="retry"], button[aria-label*="failed"]');
      if (!btn) return 'no retry btn, labels: ' + Array.from(item.querySelectorAll('button')).map(b=>b.getAttribute('aria-label')).join(', ');
      btn.click();
      return 'clicked: ' + btn.getAttribute('aria-label');
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Retry click:", retryResult.result.value);

  // Wait for download attempt
  await new Promise(r => setTimeout(r, 15000));

  console.log("\nLogs captured:");
  for (const log of logs) console.log(log);

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
