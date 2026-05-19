// Watch for PipelineFFmpegReady after offscreen recreation
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
  const allSwLogs: string[] = [];

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
      allSwLogs.push(msg);
      console.log(`[SW ${new Date().toISOString().slice(11,23)}] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      if (!desc.includes("Receiving end") && !desc.includes("Could not establish")) {
        allSwLogs.push("EXC:" + desc);
        console.log(`[SW EXC ${new Date().toISOString().slice(11,23)}] ${desc.slice(0, 200)}`);
      }
    }
  });
  await swSession.send("Runtime.enable", {});

  // Close existing offscreen and create new, watch for FFmpegReady
  console.log("=== Recreating offscreen and watching for FFmpegReady ===");

  const result = await reval(swSession, `
    (async function(){
      var hasDoc = await browser.offscreen.hasDocument();
      if(hasDoc) {
        await browser.offscreen.closeDocument();
        console.log('[WATCH] closed old offscreen');
      }
      await browser.offscreen.createDocument({
        url: '/offscreen.html',
        reasons: [browser.offscreen.Reason.WORKERS],
        justification: 'watch test'
      });
      console.log('[WATCH] created new offscreen');
      return 'created';
    })()
  `, true, "create-offscreen");
  console.log("Create result:", result);

  // Connect to new offscreen immediately
  await sleep(500);
  const targetsAfter = await getTargets();
  const newOffscreen = targetsAfter.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  const offLogs: string[] = [];

  if (newOffscreen) {
    const oSession = await openSession(newOffscreen.webSocketDebuggerUrl);
    oSession.onEvent((ev: unknown) => {
      const event = ev as { method?: string; params?: Record<string, unknown> };
      if (event.method === "Runtime.consoleAPICalled") {
        const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
        const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
        offLogs.push(msg);
        console.log(`[OFFSCREEN ${new Date().toISOString().slice(11,23)}] ${msg.slice(0, 200)}`);
      }
      if (event.method === "Runtime.exceptionThrown") {
        const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
        const desc = exc?.exception?.description ?? exc?.text ?? "";
        offLogs.push("EXC:" + desc);
        console.log(`[OFFSCREEN EXC ${new Date().toISOString().slice(11,23)}] ${desc.slice(0, 200)}`);
      }
    });
    await oSession.send("Runtime.enable", {});
    console.log("Connected to new offscreen");

    // Poll for FFmpegReady for 40s
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const elapsed = (i + 1) * 2;

      const isReady = await reval(swSession,
        "(async function(){var r=await chrome.storage.local.get(['local:isFFmpegReady','isFFmpegReady']);return JSON.stringify(r);})()",
        true
      );
      console.log(`[${elapsed}s] isFFmpegReady storage: ${isReady}`);

      if (isReady !== "{}") {
        console.log("FFmpegReady received!");
        break;
      }

      // Check what the offscreen is doing
      if (i === 2) {
        const offState = await reval(oSession, `
          (function(){
            return JSON.stringify({
              iframes: document.querySelectorAll('iframe').length,
              readyState: document.readyState,
              workers: typeof Worker !== 'undefined'
            });
          })()
        `, false);
        console.log("Offscreen state at 6s:", offState);
      }
    }

    console.log("\nOffscreen logs:", offLogs.length, offLogs.map(l => l.slice(0, 200)));
    oSession.close();
  }

  console.log("\n=== SW LOGS ===");
  allSwLogs.forEach(l => console.log("  ", l.slice(0, 200)));

  swSession.close();
}

main().catch(console.error);
