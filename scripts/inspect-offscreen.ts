// Inspect the offscreen page state directly
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
  const targets = await getTargets();
  const offscreenPage = targets.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (!offscreenPage) { console.error("No offscreen page found"); return; }
  console.log("Offscreen page:", offscreenPage.url, "type:", offscreenPage.type);

  const session = await openSession(offscreenPage.webSocketDebuggerUrl);

  // Enable all domains
  await session.send("Runtime.enable", {});
  await session.send("Log.enable", {});

  const logs: string[] = [];
  session.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      logs.push(msg);
      console.log(`[LOG] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string; url?: string } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      logs.push("EXC:" + desc);
      console.log(`[EXC] ${desc.slice(0, 300)}`);
    }
    if (event.method === "Log.entryAdded") {
      const entry = event.params?.entry as { text?: string; level?: string } | undefined;
      if (entry) {
        logs.push(`LOG:${entry.level}: ${entry.text}`);
        console.log(`[LOG.ENTRY] ${entry.level}: ${entry.text?.slice(0, 200)}`);
      }
    }
  });

  // Check what globals exist in the offscreen page
  const globals = await reval(session, `
    (function(){
      return JSON.stringify({
        readyState: document.readyState,
        hasChrome: typeof chrome !== 'undefined',
        hasBrowser: typeof browser !== 'undefined',
        hasWorker: typeof Worker !== 'undefined',
        pageTitle: document.title,
        hasIframes: document.querySelectorAll('iframe').length,
        bodyHTML: document.body&&document.body.innerHTML.slice(0,200)
      });
    })()
  `, false, "globals");
  console.log("Offscreen globals:", globals);

  // Check if there are any iframes hosted
  const iframes = await reval(session, `
    (function(){
      return JSON.stringify(Array.from(document.querySelectorAll('iframe')).map(function(f){return{id:f.id,src:f.src}}));
    })()
  `, false, "iframes");
  console.log("Hosted iframes:", iframes);

  // Check what workers are running
  const workers = await reval(session, `
    (function(){
      try {
        return JSON.stringify({ hasFFmpegWorker: typeof window.__ytdlFFmpegWorker !== 'undefined', windowKeys: Object.keys(window).filter(function(k){return k.includes('ytdl')||k.includes('ffmpeg')||k.includes('FFmpeg')}) });
      } catch(e) { return JSON.stringify({error:e.message}); }
    })()
  `, false, "workers");
  console.log("Workers/globals:", workers);

  // Try sending a test message from offscreen to SW
  const msgTest = await reval(session, `
    (async function(){
      try {
        var r = await chrome.runtime.sendMessage({type:'TEST'});
        return JSON.stringify({ok:true,r:r});
      } catch(e) {
        return JSON.stringify({error:e.message});
      }
    })()
  `, true, "msg-test");
  console.log("Message test:", msgTest);

  // Check if PipelineFFmpegReady is being sent
  const ffmpegInit = await reval(session, `
    (function(){
      return JSON.stringify({
        ytdlKeys: Object.keys(window).filter(function(k){return k.toLowerCase().includes('ytdl')||k.toLowerCase().includes('ffmpeg')}).slice(0,20)
      });
    })()
  `, false, "ffmpeg-init");
  console.log("FFmpeg init state:", ffmpegInit);

  // Wait a bit for events
  await sleep(3000);
  console.log("\nLogs collected during wait:", logs.length);
  logs.forEach(l => console.log("  ", l.slice(0, 200)));

  session.close();
}

main().catch(console.error);
