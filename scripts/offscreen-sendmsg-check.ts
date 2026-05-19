// Minimal test: does sendMessage throw synchronously in offscreen when SW is sleeping?
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
  // Wake SW first
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

  // Connect to existing offscreen (don't recreate)
  const offTarget = targets.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (!offTarget) { console.error("No offscreen"); swSession.close(); return; }

  const oSession = await openSession(offTarget.webSocketDebuggerUrl);
  const events: string[] = [];
  oSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: unknown };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params as { args?: Array<{ value?: unknown; description?: string }> }).args ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      events.push(msg);
      console.log(`[OFF] ${msg}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      console.log("!!! EXCEPTION:", JSON.stringify(event.params).slice(0, 500));
    }
  });
  await oSession.send("Runtime.enable", {});

  console.log("=== Testing what sendMessage(BgDebugLog) does synchronously ===");

  // Import the sendMessage function from the actual bundle and test it
  const test = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      // Step 1: Import the offscreen bundle to get sendMessage
      var url = chrome.runtime.getURL('/chunks/recent-downloads-db-Bw4XdKg2.js');
      console.log('[test] importing shared bundle...');
      var mod;
      try {
        mod = await import(url);
        console.log('[test] import OK, keys:', JSON.stringify(Object.keys(mod)));
      } catch(e) {
        console.log('[test] import FAILED:', String(e));
        return JSON.stringify({importError: String(e)});
      }

      // 's' export is sendMessage
      var sendMessage = mod.s || mod.sendMessage;
      var MessageType = mod.M;
      if (!sendMessage) {
        console.log('[test] sendMessage not found in module');
        return JSON.stringify({noSendMessage: true, keys: Object.keys(mod)});
      }
      if (!MessageType) {
        console.log('[test] MessageType not found, using string directly');
      }

      // Step 2: Does calling it throw synchronously?
      console.log('[test] calling sendMessage synchronously...');
      var threw = false;
      var threwError = '';
      var promise;
      try {
        promise = sendMessage('bgDebugLog', {msg: '[test] hello from direct call'});
        console.log('[test] sendMessage did NOT throw synchronously, returned:', typeof promise);
      } catch(e) {
        threw = true;
        threwError = String(e);
        console.log('[test] sendMessage THREW SYNC:', threwError);
      }

      // Step 3: What does the promise resolve/reject with?
      if (!threw && promise) {
        console.log('[test] awaiting promise...');
        try {
          var r = await promise;
          console.log('[test] promise resolved:', JSON.stringify(r));
        } catch(e2) {
          console.log('[test] promise REJECTED:', String(e2));
        }
      }

      return JSON.stringify({threw, threwError});
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Test result:", test.result.value);

  await sleep(1000);
  console.log("Events:", events);

  // Now let's let the SW sleep and retry
  console.log("\n=== Letting SW sleep (5s) then testing ===");
  await sleep(5000);

  // Check if SW is still alive
  const targets2 = await getTargets();
  const swAlive = targets2.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  console.log("SW still alive:", !!swAlive);

  // Now test sendMessage WITHOUT waking SW first
  const test2 = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      var url = chrome.runtime.getURL('/chunks/recent-downloads-db-Bw4XdKg2.js');
      var mod = await import(url);
      var sendMessage = mod.s;
      console.log('[test2] calling sendMessage with SW potentially sleeping...');
      var threw = false;
      var threwError = '';
      try {
        var p = sendMessage('bgDebugLog', {msg: '[test2] hello'});
        console.log('[test2] did not throw, awaiting...');
        try {
          var r = await p;
          console.log('[test2] resolved:', JSON.stringify(r));
        } catch(e2) {
          console.log('[test2] rejected:', String(e2));
        }
      } catch(e) {
        threw = true; threwError = String(e);
        console.log('[test2] THREW SYNC:', threwError);
      }
      return JSON.stringify({threw, threwError});
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Test2 result:", test2.result.value);

  await sleep(1000);
  console.log("All events:", events);

  oSession.close();
  swSession.close();
}

main().catch(console.error);
