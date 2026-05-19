// Check if the offscreen module fails to load/execute
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
type EvalResult = { result: { value?: string; type?: string }; exceptionDetails?: { text?: string; exception?: { description?: string }; url?: string; lineNumber?: number; columnNumber?: number } };

async function getTargets() {
  return (await fetch(`${CDP_URL}/json`).then(r => r.json())) as Target[];
}

async function revalRaw(session: Session, expression: string, awaitPromise = false) {
  return session.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }) as Promise<EvalResult>;
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

  // Create fresh offscreen
  await swSession.send("Runtime.evaluate", {
    expression: `(async function(){
      var hasDoc = await browser.offscreen.hasDocument();
      if(hasDoc) await browser.offscreen.closeDocument();
      await browser.offscreen.createDocument({
        url: '/offscreen.html',
        reasons: [browser.offscreen.Reason.WORKERS],
        justification: 'debug test'
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  await sleep(300);
  const targetsAfter = await getTargets();
  const newOffscreen = targetsAfter.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (!newOffscreen) { console.error("No offscreen found"); swSession.close(); return; }

  const oSession = await openSession(newOffscreen.webSocketDebuggerUrl);

  const allEvents: unknown[] = [];
  oSession.onEvent((ev: unknown) => {
    allEvents.push(ev);
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method?.startsWith("Runtime.") || event.method?.startsWith("Page.")) {
      console.log(`[EVENT ${new Date().toISOString().slice(11,23)}]`, JSON.stringify(event).slice(0, 300));
    }
  });

  // Enable everything
  await oSession.send("Runtime.enable", {});
  await oSession.send("Page.enable", {});
  await oSession.send("Debugger.enable", {});

  await sleep(500);

  // Try to dynamically import the offscreen bundle - will we get module error?
  console.log("\n=== Attempting dynamic import of offscreen bundle ===");
  const importTest = await revalRaw(oSession, `
    (async function(){
      try {
        var url = chrome.runtime.getURL('/chunks/offscreen-BVNygspJ.js');
        console.log('[import-test] trying to import:', url);
        // Check if already loaded by checking if module-level side effects happened
        // The script registers message listeners - check addEventListener count
        return JSON.stringify({url: url, exists: true});
      } catch(e) {
        return JSON.stringify({error: String(e), stack: e.stack && e.stack.slice(0,400)});
      }
    })()
  `, true);
  console.log("Import test:", importTest.result.value);
  if (importTest.exceptionDetails) {
    console.log("EXCEPTION:", JSON.stringify(importTest.exceptionDetails));
  }

  // Look at the actual script tag - is it type="module"?
  const scriptTag = await revalRaw(oSession, `
    (function(){
      var scripts = Array.from(document.querySelectorAll('script'));
      return JSON.stringify(scripts.map(function(s){
        return {
          src: s.src.slice(-60),
          type: s.type,
          async: s.async,
          defer: s.defer
        };
      }));
    })()
  `, false);
  console.log("Script tags:", scriptTag.result.value);

  // Check for module import errors via the inspector protocol
  // Enable Network to see if module loads fail
  await oSession.send("Network.enable", {});

  const netEvents: string[] = [];
  oSession.onEvent = (cb) => {
    // This is too late, but try anyway
    void cb;
  };

  await sleep(1000);

  // The offscreen HTML might be using type="module" - if the module fails, it fails silently
  // Let's check the HTML source
  const htmlContent = await revalRaw(oSession, `
    (function(){
      return document.documentElement.outerHTML.slice(0, 2000);
    })()
  `, false);
  console.log("HTML:", htmlContent.result.value);

  // Try to manually run the first line of the offscreen script to see what happens
  const manualTest = await revalRaw(oSession, `
    (async function(){
      console.log('[manual-test] starting manual test');
      try {
        // Test: does sendMessage work?
        var result1 = await new Promise(function(resolve) {
          setTimeout(function(){ resolve('timeout'); }, 3000);
          chrome.runtime.sendMessage(
            {type: 'BgDebugLog', data: {msg: '[manual-test] hello'}},
            function(r) {
              resolve(JSON.stringify({r: r, err: chrome.runtime.lastError && chrome.runtime.lastError.message}));
            }
          );
        });
        console.log('[manual-test] sendMessage result:', result1);

        // Test: can we fetch WASM?
        var wasmUrl = chrome.runtime.getURL('/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
        var resp = await fetch(wasmUrl);
        console.log('[manual-test] WASM fetch:', resp.status, resp.ok);
        return JSON.stringify({sendMsg: result1, wasmStatus: resp.status});
      } catch(e) {
        console.log('[manual-test] ERROR:', String(e));
        return JSON.stringify({error: String(e)});
      }
    })()
  `, true);
  console.log("Manual test:", manualTest.result.value);
  if (manualTest.exceptionDetails) {
    console.log("EXCEPTION:", JSON.stringify(manualTest.exceptionDetails).slice(0, 500));
  }

  await sleep(2000);

  console.log("\n=== All events (method only) ===");
  allEvents.forEach(e => {
    const ev = e as { method?: string };
    if (ev.method) console.log(" ", ev.method);
  });

  console.log("\n=== Network events ===");
  console.log(netEvents);

  oSession.close();
  swSession.close();
}

main().catch(console.error);
