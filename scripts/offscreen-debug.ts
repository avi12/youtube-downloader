// Deep-inspect the new offscreen after creation - check for exceptions, eval globals, etc
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

  // Connect to new offscreen immediately BEFORE it finishes loading
  await sleep(300);
  const targetsAfter = await getTargets();
  const newOffscreen = targetsAfter.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (!newOffscreen) { console.error("No new offscreen found"); swSession.close(); return; }

  console.log("Offscreen target:", newOffscreen.url, newOffscreen.type);

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
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string; stackTrace?: { callFrames?: Array<{functionName: string; url: string; lineNumber: number}> } } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      const stack = exc?.stackTrace?.callFrames?.map(f => `${f.functionName}@${f.url.slice(-40)}:${f.lineNumber}`).join(", ") ?? "";
      offExceptions.push(desc + " | " + stack);
      console.log(`[OFF EXC ${new Date().toISOString().slice(11,23)}] ${desc.slice(0, 300)}`);
      if (stack) console.log(`  stack: ${stack.slice(0, 200)}`);
    }
  });

  // Enable Runtime + Console APIs
  await oSession.send("Runtime.enable", {});
  await oSession.send("Console.enable", {});

  console.log("Connected to offscreen, enabling Runtime...");

  // Poll offscreen state every 2s for 20s
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const elapsed = (i + 1) * 2;

    // Check globals that should be set if the offscreen script ran
    const state = await reval(oSession, `
      (function(){
        return JSON.stringify({
          readyState: document.readyState,
          scripts: Array.from(document.querySelectorAll('script')).map(function(s){return s.src.slice(-60)}).filter(Boolean),
          iframes: document.querySelectorAll('iframe').length,
          workers: typeof Worker,
          hasChrome: typeof chrome !== 'undefined',
          hasBrowser: typeof browser !== 'undefined',
          chromeRuntimeId: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null
        });
      })()
    `, false);
    console.log(`[${elapsed}s] Offscreen state: ${state}`);

    // Try fetching the WASM URL directly from offscreen context
    if (i === 1) {
      const wasmTest = await reval(oSession, `
        (async function(){
          try {
            var url = chrome.runtime.getURL('/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
            var resp = await fetch(url);
            return JSON.stringify({url: url.slice(-50), ok: resp.ok, status: resp.status, size: resp.headers.get('content-length')});
          } catch(e) {
            return JSON.stringify({error: String(e)});
          }
        })()
      `, true, "wasm-fetch");
      console.log(`[${elapsed}s] WASM fetch test: ${wasmTest}`);
    }

    // Check if there's a service worker registered
    if (i === 2) {
      const swCheck = await reval(oSession, `
        (async function(){
          try {
            var regs = await navigator.serviceWorker.getRegistrations();
            return JSON.stringify({swCount: regs.length});
          } catch(e) {
            return JSON.stringify({swError: String(e)});
          }
        })()
      `, true);
      console.log(`[${elapsed}s] SW registrations from offscreen: ${swCheck}`);

      // Check if runtime.sendMessage works from offscreen
      const msgTest = await reval(oSession, `
        (function(){
          return new Promise(function(resolve) {
            setTimeout(function(){resolve(JSON.stringify({result:'timeout'}));}, 3000);
            chrome.runtime.sendMessage({type:'TEST_FROM_OFFSCREEN'}, function(r){
              resolve(JSON.stringify({result: r, error: chrome.runtime.lastError && chrome.runtime.lastError.message}));
            });
          });
        })()
      `, true, "msg-test");
      console.log(`[${elapsed}s] sendMessage test: ${msgTest}`);
    }
  }

  console.log("\n=== Offscreen logs:", offLogs.length, "===");
  offLogs.forEach(l => console.log(" ", l.slice(0, 300)));
  console.log("\n=== Offscreen exceptions:", offExceptions.length, "===");
  offExceptions.forEach(l => console.log(" ", l.slice(0, 400)));

  oSession.close();
  swSession.close();
}

main().catch(console.error);
