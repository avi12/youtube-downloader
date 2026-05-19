// Check if the top-level await module code actually executes or has import errors
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
type EvalResult = { result: { value?: string; type?: string }; exceptionDetails?: object };

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

  // Close existing offscreen
  await swSession.send("Runtime.evaluate", {
    expression: "(async function(){var h=await browser.offscreen.hasDocument();if(h)await browser.offscreen.closeDocument();return h;})()",
    awaitPromise: true, returnByValue: true
  });
  await sleep(200);

  // Create offscreen and immediately connect
  const createP = swSession.send("Runtime.evaluate", {
    expression: `(async function(){
      await browser.offscreen.createDocument({url:'/offscreen.html',reasons:[browser.offscreen.Reason.WORKERS],justification:'test'});
      return 'done';
    })()`,
    awaitPromise: true, returnByValue: true
  });

  let oSession: Session | null = null;
  for (let i = 0; i < 30; i++) {
    await sleep(30);
    const ts = await getTargets();
    const off = ts.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
    if (off) {
      oSession = await openSession(off.webSocketDebuggerUrl);
      console.log(`Connected at ${i * 30}ms`);
      break;
    }
  }
  if (!oSession) { console.error("No offscreen"); swSession.close(); return; }

  const events: Array<{ method: string; data: string }> = [];
  oSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: unknown };
    if (!event.method) return;
    const data = JSON.stringify(event.params).slice(0, 300);
    events.push({ method: event.method, data });
    if (event.method === "Runtime.exceptionThrown") {
      console.log(`!!! EXCEPTION: ${data}`);
    }
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params as { args?: Array<{ value?: unknown; description?: string }> }).args ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      console.log(`[OFF] ${msg.slice(0, 300)}`);
    }
  });

  await oSession.send("Runtime.enable", {});
  await oSession.send("Debugger.enable", {});

  // Wait for createDocument
  await createP;
  console.log("createDocument done");

  // Wait a moment for the module to execute
  await sleep(3000);

  // Check: has the module's onConnect listener been registered?
  // We can test by calling runtime.connect and seeing if the message listener fires
  const connectTest = await oSession.send("Runtime.evaluate", {
    expression: `(function(){
      try {
        // Try to connect to the port that listenForOffscreenMessages uses
        var port = chrome.runtime.connect({name: 'ytdl-offscreen'});
        var received = [];
        port.onMessage.addListener(function(msg){ received.push(msg); });
        port.onDisconnect.addListener(function(){ received.push('disconnected'); });
        setTimeout(function(){ console.log('[port-test] port connected, messages:', JSON.stringify(received)); }, 1000);
        return JSON.stringify({portConnected: true, portName: port.name});
      } catch(e) {
        return JSON.stringify({portError: String(e)});
      }
    })()`,
    returnByValue: true
  }) as EvalResult;
  console.log("Port connect test:", connectTest.result.value);

  // Check if the worker exists
  await sleep(1000);
  const workerCheck = await oSession.send("Runtime.evaluate", {
    expression: `(function(){
      // Check if any global state was set by the offscreen module
      return JSON.stringify({
        onConnectListeners: 'unknown',
        iframes: document.querySelectorAll('iframe').length,
        readyState: document.readyState
      });
    })()`,
    returnByValue: true
  }) as EvalResult;
  console.log("Worker check:", workerCheck.result.value);

  // Try dynamic import of the offscreen module to see if it throws
  console.log("\n=== Testing dynamic import ===");
  const dynImport = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      try {
        console.log('[dyn-import] starting');
        var url = chrome.runtime.getURL('/chunks/offscreen-BVNygspJ.js');
        var mod = await import(url);
        console.log('[dyn-import] success:', JSON.stringify(Object.keys(mod)));
        return JSON.stringify({success: true, keys: Object.keys(mod)});
      } catch(e) {
        console.log('[dyn-import] FAILED:', String(e));
        return JSON.stringify({error: String(e), stack: e.stack && e.stack.slice(0, 500)});
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as EvalResult;
  console.log("Dynamic import result:", dynImport.result.value);
  if (dynImport.exceptionDetails) console.log("Exception:", JSON.stringify(dynImport.exceptionDetails).slice(0, 500));

  await sleep(2000);

  console.log("\n=== All events summary ===");
  const methodCounts = new Map<string, number>();
  events.forEach(e => methodCounts.set(e.method, (methodCounts.get(e.method) ?? 0) + 1));
  methodCounts.forEach((count, method) => console.log(`  ${method}: ${count}`));

  oSession.close();
  swSession.close();
}

main().catch(console.error);
