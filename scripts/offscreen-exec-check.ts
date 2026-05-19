// Check if offscreen main.ts code actually executes, and why it produces no console output
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
type EvalResult = { result: { value: string; type?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } };

async function getTargets() {
  return (await fetch(`${CDP_URL}/json`).then(r => r.json())) as Target[];
}

async function reval(session: Session, expression: string, awaitPromise = false, label = "") {
  const r = await session.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }) as EvalResult;
  if (r.exceptionDetails) {
    const desc = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "unknown";
    console.error(`[Exception${label ? " in " + label : ""}]`, desc.slice(0, 400));
  }
  return r.result.value;
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

  // Enable Runtime on SW and watch for ALL events including those from offscreen
  const swLogs: string[] = [];
  swSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      swLogs.push(msg);
      console.log(`[SW ${new Date().toISOString().slice(11,23)}] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      if (!desc.includes("Receiving end") && !desc.includes("Could not establish")) {
        swLogs.push("EXC:" + desc);
        console.log(`[SW EXC ${new Date().toISOString().slice(11,23)}] ${desc.slice(0, 300)}`);
      }
    }
  });
  await swSession.send("Runtime.enable", {});

  // Close and recreate offscreen
  await reval(swSession, `
    (async function(){
      var hasDoc = await browser.offscreen.hasDocument();
      if(hasDoc) await browser.offscreen.closeDocument();
      await browser.offscreen.createDocument({
        url: '/offscreen.html',
        reasons: [browser.offscreen.Reason.WORKERS],
        justification: 'debug test'
      });
      return 'created';
    })()
  `, true, "create");

  console.log("Offscreen created. Connecting...");

  // Connect immediately
  await sleep(200);
  const targetsAfter = await getTargets();
  const newOffscreen = targetsAfter.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (!newOffscreen) { console.error("No new offscreen found"); swSession.close(); return; }

  const oSession = await openSession(newOffscreen.webSocketDebuggerUrl);

  const offLogs: string[] = [];
  const offExceptions: string[] = [];
  oSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      offLogs.push(msg);
      console.log(`[OFF ${new Date().toISOString().slice(11,23)}] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string; url?: string; lineNumber?: number } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      offExceptions.push(desc);
      console.log(`[OFF EXC ${new Date().toISOString().slice(11,23)}] ${desc.slice(0, 300)}`);
      console.log(`  at ${exc?.url}:${exc?.lineNumber}`);
    }
  });
  await oSession.send("Runtime.enable", {});

  // Immediately try to console.log from offscreen to verify CDP works
  const testLog = await reval(oSession, `
    (function(){
      console.log('[CDP-TEST] console log from offscreen');
      return 'ok';
    })()
  `, false);
  console.log("CDP console test result:", testLog);
  await sleep(200);

  // Check if the main script is waiting on something by inspecting its module state
  const scriptInfo = await reval(oSession, `
    (async function(){
      // Try to find what the script is doing by checking for any globals it would set
      // The script uses initIframeMessageRelay - check if message listener is registered
      var listeners = window.__ytdlOffscreenListeners;

      // Check if there's a pending promise on sendMessage
      return JSON.stringify({
        readyState: document.readyState,
        hasListeners: typeof window.__ytdlOffscreenListeners !== 'undefined',
        workerType: typeof Worker,
      });
    })()
  `, true);
  console.log("Script info:", scriptInfo);

  // The key test: try to invoke chrome.runtime.sendMessage from offscreen right now
  // and see if the SW receives it
  console.log("\n=== Testing sendMessage from offscreen ===");
  const sendTest = await reval(oSession, `
    (async function(){
      return new Promise(function(resolve) {
        setTimeout(function(){resolve(JSON.stringify({result:'timeout'}));}, 5000);
        chrome.runtime.sendMessage(
          {type:'BgDebugLog', data:{msg:'[CDP direct test] hello from offscreen'}},
          function(r) {
            resolve(JSON.stringify({response: r, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message}));
          }
        );
      });
    })()
  `, true, "direct-send");
  console.log("Direct sendMessage result:", sendTest);
  await sleep(500);
  console.log("SW logs after direct send:", swLogs.slice(-5));

  // Now test creating a Worker from offscreen
  console.log("\n=== Testing Worker creation from offscreen ===");
  const workerTest = await reval(oSession, `
    (async function(){
      try {
        var workerUrl = chrome.runtime.getURL('/chunks/mux-worker.js');
        return JSON.stringify({workerUrl: workerUrl});
      } catch(e) {
        return JSON.stringify({error: String(e)});
      }
    })()
  `, true, "worker-url");
  console.log("Worker URL:", workerTest);

  await sleep(5000);
  console.log("\n=== Summary ===");
  console.log("Offscreen logs:", offLogs.length, offLogs);
  console.log("Offscreen exceptions:", offExceptions.length, offExceptions);
  console.log("SW logs:", swLogs.length);

  oSession.close();
  swSession.close();
}

main().catch(console.error);
