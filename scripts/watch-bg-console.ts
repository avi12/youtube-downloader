// Watch the extension background service worker console for ytdl logs
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string; title: string }>;
  const sw = targets.find(t => t.type === "service_worker" && t.url.includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
  if (!sw) { console.error("Extension SW not found"); return; }

  console.log("Connecting to SW:", sw.title);

  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();

  function send(method: string, params: object = {}) {
    return new Promise((res, rej) => {
      const id = msgId++;
      pending.set(id, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
    if (msg.id !== undefined) {
      const h = pending.get(msg.id);
      if (h) { pending.delete(msg.id); msg.error ? h.reject(msg.error) : h.resolve(msg.result); }
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const p = msg.params as { type: string; args: { value?: unknown; description?: string }[] };
      const args = p.args.map(a => a.value ?? a.description ?? "").join(" ");
      console.log(`[bg:${p.type}]`, String(args).slice(0, 300));
    }
  });

  await new Promise(resolve => ws.on("open", resolve));
  await send("Runtime.enable");
  console.log("Listening to background SW console for 120s...\n");
  await sleep(120_000);
  ws.close();
}

main().catch(console.error);
