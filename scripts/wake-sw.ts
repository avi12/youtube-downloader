import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
type Target = { type: string; url: string; id: string; webSocketDebuggerUrl: string };
type EvalResult = { result: { value: string } };

async function main() {
  // Try waking SW by sending a message from the offscreen page
  const targets = await fetch(`${CDP_URL}/json`).then(r => r.json()) as Target[];

  const offscreen = targets.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (offscreen) {
    console.log("Found offscreen page:", offscreen.url);
    const offSession = await openSession(offscreen.webSocketDebuggerUrl);
    const r = await offSession.send("Runtime.evaluate", {
      expression: "chrome.runtime.sendMessage({type:'WAKE'}, function(r){ console.log('wake resp', r); }); 'sent'",
      returnByValue: true
    }) as EvalResult;
    console.log("Wake from offscreen:", r.result.value);
    offSession.close();
    await sleep(2000);
  }

  // Check if SW is up now
  const targets2 = await fetch(`${CDP_URL}/json`).then(r => r.json()) as Target[];
  const sw = targets2.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  console.log("SW found:", !!sw, sw?.url ?? "");

  if (!sw) {
    // Try via extensions page chrome.management reload
    const extPage = targets2.find(t => t.url === "chrome://extensions/");
    if (extPage) {
      const extSession = await openSession(extPage.webSocketDebuggerUrl);
      const r2 = await extSession.send("Runtime.evaluate", {
        expression: `(async function(){
          const mgr = document.querySelector("extensions-manager");
          const sr = mgr&&mgr.shadowRoot;
          const toolbar = sr&&sr.querySelector("extensions-toolbar");
          const tbSr = toolbar&&toolbar.shadowRoot;
          const devMode = tbSr&&tbSr.querySelector("#devMode");
          console.log("devMode:", devMode&&devMode.checked);
          return "checked devMode: " + (devMode&&devMode.checked);
        })()`,
        awaitPromise: true,
        returnByValue: true
      }) as EvalResult;
      console.log("Dev mode check:", r2.result.value);
      extSession.close();
    }
    console.log("SW still not found. Targets:", targets2.map(t => `${t.type}:${t.url.slice(0,60)}`).join("\n  "));
  }
}

main().catch(console.error);
