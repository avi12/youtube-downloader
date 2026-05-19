// Test: manually close and recreate offscreen doc, watch if FFmpegReady arrives
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
type EvalResult = { result: { value: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } };

async function getTargets() {
  return (await fetch(`${CDP_URL}/json`).then(r => r.json())) as Target[];
}

async function reval(session: Session, expression: string, awaitPromise = false, label = "") {
  const r = await session.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }) as EvalResult;
  if (r.exceptionDetails) {
    const desc = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "unknown";
    if (label) console.error(`[Exception in ${label}]`, desc.slice(0, 300));
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

  const swLogs: string[] = [];
  swSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string; preview?: { properties?: Array<{name: string; value?: string}> } }>) ?? [];
      const msg = args.map(a => {
        if (a.value !== undefined) return String(a.value);
        if (a.description) return a.description;
        if (a.preview?.properties) return JSON.stringify(Object.fromEntries(a.preview.properties.map(p => [p.name, p.value])));
        return "[object]";
      }).join(" ");
      swLogs.push(msg);
      console.log(`[SW] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      if (!desc.includes("Receiving end does not exist") && !desc.includes("Could not establish connection")) {
        swLogs.push("EXC:" + desc);
        console.log(`[SW EXC] ${desc.slice(0, 200)}`);
      }
    }
  });
  await swSession.send("Runtime.enable", {});

  console.log("=== Test: Close and recreate offscreen doc ===");

  const targetsBefore = await getTargets();
  const offscreenBefore = targetsBefore.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  console.log("Offscreen before:", offscreenBefore?.type);

  // Close and recreate
  const recreateResult = await reval(swSession, `
    (async function(){
      console.log('[RECREATE] Step 1: hasDocument?');
      var hasDoc = await browser.offscreen.hasDocument();
      console.log('[RECREATE] hasDocument:', hasDoc);

      if(hasDoc) {
        console.log('[RECREATE] Step 2: closeDocument');
        await browser.offscreen.closeDocument();
        console.log('[RECREATE] closed');
      }

      console.log('[RECREATE] Step 3: createDocument');
      await browser.offscreen.createDocument({
        url: '/offscreen.html',
        reasons: [browser.offscreen.Reason.WORKERS],
        justification: 'test recreation'
      });
      console.log('[RECREATE] created');
      return JSON.stringify({done: true});
    })()
  `, true, "recreate");
  console.log("Recreate result:", recreateResult);

  // Connect to new offscreen immediately
  await sleep(500);
  const targets2 = await getTargets();
  const offscreenAfter = targets2.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  console.log("Offscreen after:", offscreenAfter?.url);

  const offLogs: string[] = [];
  if (offscreenAfter) {
    const oSession = await openSession(offscreenAfter.webSocketDebuggerUrl);
    oSession.onEvent((ev: unknown) => {
      const event = ev as { method?: string; params?: Record<string, unknown> };
      if (event.method === "Runtime.consoleAPICalled") {
        const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
        const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
        offLogs.push(msg);
        console.log(`[OFFSCREEN] ${msg.slice(0, 200)}`);
      }
      if (event.method === "Runtime.exceptionThrown") {
        const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
        const desc = exc?.exception?.description ?? exc?.text ?? "";
        offLogs.push("EXC:" + desc);
        console.log(`[OFFSCREEN EXC] ${desc.slice(0, 200)}`);
      }
    });
    await oSession.send("Runtime.enable", {});

    // Check if script is loaded and running
    await sleep(1000);
    const offState = await reval(oSession, `
      (function(){
        return JSON.stringify({
          scripts: Array.from(document.querySelectorAll('script')).map(function(s){return s.src.slice(-50)}).filter(Boolean),
          iframes: document.querySelectorAll('iframe').length,
          readyState: document.readyState
        });
      })()
    `, false);
    console.log("Offscreen state 1s after creation:", offState);

    // Wait 15 more seconds for FFmpeg to load
    await sleep(15000);

    const offState2 = await reval(oSession, `
      (function(){
        return JSON.stringify({
          iframes: document.querySelectorAll('iframe').length,
          workers: typeof Worker !== 'undefined' ? 'available' : 'unavailable'
        });
      })()
    `, false);
    console.log("Offscreen state 16s after creation:", offState2);

    console.log("Offscreen logs (", offLogs.length, "):", offLogs.map(l => l.slice(0, 200)));
    oSession.close();
  }

  // Check SW got FFmpegReady
  const isReady = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['isFFmpegReady','local:isFFmpegReady']);return JSON.stringify(r);})()",
    true
  );
  console.log("isFFmpegReady storage:", isReady);

  console.log("\nSW logs:", swLogs.map(l => l.slice(0, 200)));
  swSession.close();
}

main().catch(console.error);
