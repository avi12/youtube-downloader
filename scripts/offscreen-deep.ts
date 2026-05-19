// Deep inspection of offscreen page - check scripts loaded
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
  if (!offscreenPage) { console.error("No offscreen page"); return; }

  const session = await openSession(offscreenPage.webSocketDebuggerUrl);

  await session.send("Runtime.enable", {});

  const allEvents: string[] = [];
  session.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      allEvents.push("LOG:" + msg);
      console.log("[LOG]", msg.slice(0, 200));
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      allEvents.push("EXC:" + desc);
      console.log("[EXC]", desc.slice(0, 200));
    }
    if (event.method === "Runtime.executionContextCreated") {
      allEvents.push("CTX:" + JSON.stringify(event.params?.context));
      console.log("[CTX]", JSON.stringify(event.params?.context)?.slice(0, 100));
    }
  });

  // Get scripts loaded
  const scripts = await session.send("Runtime.evaluate", {
    expression: "JSON.stringify(Array.from(document.querySelectorAll('script')).map(function(s){return{src:s.src,type:s.type,inline:s.textContent.length}}))",
    returnByValue: true
  }) as EvalResult;
  console.log("Scripts in document:", scripts.result.value);

  // Check if the offscreen module was executed
  const moduleCheck = await reval(session, `
    (function(){
      try {
        return JSON.stringify({
          hasListenForOffscreenMessages: typeof listenForOffscreenMessages !== 'undefined',
          hasSpawnIframe: typeof spawnIframe !== 'undefined',
          hasInitIframeMessageRelay: typeof initIframeMessageRelay !== 'undefined',
          windowYtdlKeys: Object.keys(window).filter(function(k){return k.includes('ytdl')||k.includes('Ytdl')}).slice(0,20),
          bodyClass: document.body&&document.body.className
        });
      } catch(e) { return JSON.stringify({error:e.message}); }
    })()
  `, false);
  console.log("Module check:", moduleCheck);

  // Try to manually trigger what the offscreen main.ts should have done
  const manualTest = await reval(session, `
    (async function(){
      try {
        // Send a PipelineFFmpegReady message to the SW to see if it responds
        var r = await chrome.runtime.sendMessage({type:'pipelineFFmpegReady'});
        return JSON.stringify({sent:true, response: r});
      } catch(e) {
        return JSON.stringify({error:e.message});
      }
    })()
  `, true, "manual-test");
  console.log("Manual FFmpegReady message:", manualTest);

  // Check the offscreen URL with versioning info
  const urlCheck = await reval(session, `
    (function(){
      return JSON.stringify({
        href: location.href,
        origin: location.origin
      });
    })()
  `, false);
  console.log("Offscreen URL:", urlCheck);

  // Inspect resource timing to see what fetches happened
  const resourceTiming = await reval(session, `
    (function(){
      var entries = performance.getEntriesByType('resource');
      return JSON.stringify(entries.map(function(e){return{name:e.name.slice(-60),duration:Math.round(e.duration),status:e.transferSize}}));
    })()
  `, false);
  console.log("Resource timing:", resourceTiming);

  await sleep(2000);
  console.log("\nEvents during wait:", allEvents.length);
  allEvents.forEach(e => console.log("  ", e.slice(0, 200)));

  session.close();
}

main().catch(console.error);
