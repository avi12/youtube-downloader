import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const EXTENSION_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

type Session = {
  send: (method: string, params?: object) => Promise<unknown>;
  close: () => void;
};

function openSession(wsUrl: string): Promise<Session> {
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
        const h = pending.get(msg.id);
        if (h) { pending.delete(msg.id); if (msg.error) h.reject(msg.error); else h.resolve(msg.result); }
      }
    });
    ws.on("error", reject);
  });
}

type Target = { type: string; url: string; id: string; webSocketDebuggerUrl: string };
type EvalResult = { result: { value: string } };

async function main() {
  const targets = await fetch(`${CDP_URL}/json`).then(r => r.json()) as Target[];
  const extPage = targets.find(t => t.url === "chrome://extensions/");
  if (!extPage) { console.error("No extensions page"); return; }

  const session = await openSession(extPage.webSocketDebuggerUrl);

  // Inspect DOM
  const domResult = await session.send("Runtime.evaluate", {
    expression: `
      (() => {
        const mgr = document.querySelector("extensions-manager");
        if (!mgr) return "no extensions-manager";
        const sr = mgr.shadowRoot;
        if (!sr) return "no shadowRoot on mgr";
        const itemList = sr.querySelector("extensions-item-list");
        if (!itemList) return "no item-list, sr children: " + Array.from(sr.children).map(c => c.tagName).join(",");
        const itemListSr = itemList.shadowRoot;
        if (!itemListSr) return "no shadowRoot on item-list";
        const items = Array.from(itemListSr.querySelectorAll("extensions-item"));
        return "items: " + items.map(i => i.getAttribute("id")).join(",");
      })()
    `,
    returnByValue: true
  }) as EvalResult;
  console.log("Extensions DOM:", domResult.result.value);

  // Try reload using chrome.management API
  const mgmtResult = await session.send("Runtime.evaluate", {
    expression: `
      (async () => {
        try {
          await chrome.management.setEnabled("${EXTENSION_ID}", false);
          await new Promise(r => setTimeout(r, 500));
          await chrome.management.setEnabled("${EXTENSION_ID}", true);
          return "reloaded via management API";
        } catch(e) {
          return "management API error: " + e.message;
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true
  }) as EvalResult;
  console.log("Management reload:", mgmtResult.result.value);

  session.close();
}

main().catch(console.error);
