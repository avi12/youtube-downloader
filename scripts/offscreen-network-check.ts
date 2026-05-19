// Check if any script/module fails to load in the offscreen document
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

type Session = {
  send: (method: string, params?: object) => Promise<unknown>;
  close: () => void;
  onEvent: (cb: (ev: unknown) => void) => void;
};

function openSession(wsUrl: string): Promise<Session> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    let eventHandler: ((ev: unknown) => void) | null = null;
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
        onEvent(cb) { eventHandler = cb; }
      });
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const h = pending.get(msg.id);
        if (h) { pending.delete(msg.id); if (msg.error) h.reject(msg.error); else h.resolve(msg.result); }
      } else if (eventHandler) { eventHandler(msg); }
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
type Target = { type: string; url: string; id: string; webSocketDebuggerUrl: string };

async function getTargets() {
  return (await fetch(`${CDP_URL}/json`).then(r => r.json())) as Target[];
}

async function main() {
  // Wake SW
  const targets0 = await getTargets();
  const offscreen0 = targets0.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (offscreen0) {
    const oSession = await openSession(offscreen0.webSocketDebuggerUrl);
    await oSession.send("Runtime.evaluate", { expression: "chrome.runtime.sendMessage({type:'WAKE'},function(){});'sent'", returnByValue: true });
    oSession.close();
  }
  await sleep(2000);

  const targets = await getTargets();
  const swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!swTarget) { console.error("SW not found"); return; }

  const swSession = await openSession(swTarget.webSocketDebuggerUrl);
  await swSession.send("Runtime.enable", {});

  // Create fresh offscreen - but THIS time attach Network BEFORE creation
  // by using an intermediate approach: delete old offscreen first
  const hasDoc = await swSession.send("Runtime.evaluate", {
    expression: "(async function(){return await browser.offscreen.hasDocument();})()",
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: boolean } };

  if (hasDoc.result.value) {
    await swSession.send("Runtime.evaluate", {
      expression: "(async function(){await browser.offscreen.closeDocument();})()",
      awaitPromise: true,
      returnByValue: true
    });
    console.log("Closed old offscreen");
    await sleep(200);
  }

  // Now the offscreen is gone - create new one and immediately get the target
  // We'll create it via SW and race to connect
  const createPromise = swSession.send("Runtime.evaluate", {
    expression: `(async function(){
      await browser.offscreen.createDocument({
        url: '/offscreen.html',
        reasons: [browser.offscreen.Reason.WORKERS],
        justification: 'network debug'
      });
      return 'done';
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  // Poll for offscreen target immediately
  let oSession: Session | null = null;
  let newOffscreen: Target | null = null;
  for (let i = 0; i < 20; i++) {
    await sleep(50);
    const t = await getTargets();
    const off = t.find(x => x.url.includes("offscreen.html") && x.url.includes("iakm"));
    if (off && !newOffscreen) {
      newOffscreen = off;
      console.log(`Found offscreen at ${i * 50}ms`);
      oSession = await openSession(off.webSocketDebuggerUrl);

      const events: Array<{ method: string; params: unknown }> = [];
      oSession.onEvent((ev: unknown) => {
        const event = ev as { method?: string; params?: unknown };
        if (event.method) {
          events.push({ method: event.method, params: event.params });
          const m = event.method;
          if (m === "Network.loadingFailed" || m === "Debugger.scriptFailedToParse" || m === "Runtime.exceptionThrown") {
            console.log(`!!! ${m}:`, JSON.stringify(event.params).slice(0, 400));
          } else if (m === "Network.responseReceived") {
            const p = event.params as { response?: { url: string; status: number } };
            const url = p.response?.url ?? "";
            const status = p.response?.status ?? 0;
            if (!url.includes("ffmpeg-core.wasm")) {
              console.log(`NET response: ${status} ${url.slice(-80)}`);
            }
          } else if (m === "Network.requestWillBeSent") {
            const p = event.params as { request?: { url: string } };
            console.log(`NET request: ${(p.request?.url ?? "").slice(-80)}`);
          } else if (m === "Runtime.consoleAPICalled") {
            const args = (event.params as { args?: Array<{ value?: unknown; description?: string }> }).args ?? [];
            const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
            console.log(`[OFF] ${msg.slice(0, 300)}`);
          }
        }
      });

      // Enable all the things ASAP
      await oSession.send("Network.enable", {});
      await oSession.send("Runtime.enable", {});
      await oSession.send("Debugger.enable", {});
      console.log("Enabled CDP domains on offscreen");

      // Wait for creation to complete
      await createPromise;
      console.log("createDocument resolved");

      // Wait for scripts to load
      await sleep(5000);

      console.log("\n=== All events ===");
      events.forEach(e => {
        if (e.method !== "Network.dataReceived" && e.method !== "Debugger.scriptParsed") {
          console.log(`  ${e.method}: ${JSON.stringify(e.params).slice(0, 200)}`);
        } else if (e.method === "Debugger.scriptParsed") {
          const p = e.params as { url: string; scriptId: string };
          console.log(`  ${e.method}: ${p.url.slice(-60)} (id=${p.scriptId})`);
        }
      });

      break;
    }
  }

  if (!oSession) {
    await createPromise;
    console.log("Could not connect to offscreen before createDocument resolved");
  }

  swSession.close();
  if (oSession) oSession.close();
}

main().catch(console.error);
