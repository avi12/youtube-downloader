import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

async function main() {
  const res = await fetch(`${CDP_URL}/json`);
  const targets = await res.json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string; title: string }>;

  // Find the chrome://downloads page
  const dlPage = targets.find(t => t.url === "chrome://downloads/");
  if (!dlPage) {
    console.log("No downloads page open. Targets:", targets.map(t => t.url));
    return;
  }

  const ws = new WebSocket(dlPage.webSocketDebuggerUrl);
  await new Promise(r => ws.on("open", r));

  let msgId = 1;
  const pending = new Map<number, (m: unknown) => void>();
  ws.on("message", d => {
    const m = JSON.parse(d.toString()) as { id?: number };
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  });

  function send(method: string, params: object = {}) {
    return new Promise<{ result: { value?: string; description?: string; subtype?: string } }>(res => {
      const id = msgId++;
      pending.set(id, res as (m: unknown) => void);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const r = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const items = document.querySelectorAll('downloads-item');
        return JSON.stringify(Array.from(items).slice(0, 10).map(item => {
          const shadow = item.shadowRoot;
          if (!shadow) return { noShadow: true };
          const filename = shadow.querySelector('#name')?.textContent?.trim();
          const url = shadow.querySelector('#url')?.textContent?.trim();
          const status = shadow.querySelector('#description')?.textContent?.trim();
          return { filename, status };
        }));
      })()
    `,
    returnByValue: true
  });

  console.log("Downloads page items:");
  console.log(r.result.value ? JSON.stringify(JSON.parse(r.result.value), null, 2) : JSON.stringify(r.result));

  ws.close();
}

main().catch(console.error);
