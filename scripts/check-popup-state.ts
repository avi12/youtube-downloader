// Wake up SW and check extension storage
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

async function getTargets() {
  const res = await fetch(`${CDP_URL}/json`);
  return res.json() as Promise<Array<{ id: string; type: string; title: string; url: string; webSocketDebuggerUrl: string }>>;
}

function cdpSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
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
  const targets = await getTargets();
  console.log("All targets:");
  for (const t of targets) {
    console.log(` - [${t.type}] ${t.title?.slice(0, 70)}`);
    console.log(`   ${t.url?.slice(0, 90)}`);
  }

  // Look for any extension target
  const extTarget = targets.find(t =>
    t.url?.includes("chrome-extension://") ||
    t.type === "service_worker" ||
    t.type === "background_page"
  );

  if (!extTarget) {
    console.log("\nNo extension target found. SW is inactive.");
    console.log("Available browsers/ext tabs: none");

    // Try activating the SW by hitting the extension URL directly
    const allJson = await fetch(`${CDP_URL}/json/list`).then(r => r.json()) as typeof targets;
    console.log("\nFull list:");
    for (const t of allJson) console.log(` - [${t.type}] ${t.url}`);
    return;
  }

  console.log("\nUsing:", extTarget.url);
  const session = await cdpSession(extTarget.webSocketDebuggerUrl);

  const result = await session.send("Runtime.evaluate", {
    expression: `(async () => {
      const r = await chrome.storage.local.get(["videoDetails", "videoQueue", "musicList", "videoOnlyList"]);
      return JSON.stringify(r, null, 2);
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };

  console.log("\nStorage state:");
  console.log(result.result.value);

  session.close();
}

main().catch(console.error);
