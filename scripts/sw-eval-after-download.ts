// Eval into SW right after download click to trace what's happening
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";

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
  const playlistPage = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  const swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!playlistPage || !swTarget) { console.error("Missing targets"); return; }

  const pageSession = await openSession(playlistPage.webSocketDebuggerUrl);
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
      swLogs.push("EXC:" + desc.slice(0, 100));
      if (!desc.includes("Receiving end") && !desc.includes("Could not establish")) {
        console.log(`[SW EXC] ${desc.slice(0, 200)}`);
      }
    }
  });
  await swSession.send("Runtime.enable", {});

  // Clear state
  await reval(swSession, "(async function(){await chrome.storage.local.set({videoQueue:[],statusProgress:{},videoDetails:{}});})()", true);

  // Select and download
  await reval(pageSession,
    "Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label=\"Select for download\"]')).filter(function(cb){return cb.getAttribute('aria-checked')==='true'}).forEach(function(cb){cb.removeAttribute('checked');cb.setAttribute('aria-checked','false');cb.dispatchEvent(new Event('change',{bubbles:true}));});",
    false
  );
  await sleep(300);
  await reval(pageSession,
    "(function(){var item=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[1];if(item){var cb=item.querySelector('tp-yt-paper-checkbox[aria-label=\"Select for download\"]');if(cb)cb.click();}})()",
    false
  );
  await sleep(400);
  await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){return b.getAttribute('aria-label')==='Separate files'});if(btn)btn.click();})()",
    false
  );
  await sleep(200);

  const dlResult = await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){var label=b.getAttribute('aria-label')||'';return label.toLowerCase().indexOf('download')===0&&label.toLowerCase().indexOf('whole')===-1});if(!btn)return JSON.stringify({notFound:true});btn.click();return JSON.stringify({clicked:true,label:btn.getAttribute('aria-label')})})()",
    false
  );
  console.log("Download click:", dlResult);

  await sleep(1000);

  // Now inspect what's happening in the SW
  // Use SW eval to trace the download dispatch state
  const dispatchTrace = await reval(swSession, `
    (async function(){
      // Check what happens when we call spawnHostedIframe
      try {
        // Check if ensureProcessor has been called
        var contexts = await browser.runtime.getContexts({contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT]});
        return JSON.stringify({
          offscreenContexts: contexts.length,
          contexts: contexts.map(function(c){return{url:c.documentUrl, type:c.contextType}})
        });
      } catch(e) {
        return JSON.stringify({error: e.message, stack: e.stack&&e.stack.slice(0,200)});
      }
    })()
  `, true, "dispatch-trace");
  console.log("SW dispatch trace:", dispatchTrace);

  // Try to manually trigger spawnHostedIframe to see what error occurs
  const iframeTest = await reval(swSession, `
    (async function(){
      try {
        // Check if browser.offscreen API is available
        var hasOffscreen = typeof browser.offscreen !== 'undefined';
        var offscreenMethods = hasOffscreen ? Object.keys(browser.offscreen) : [];

        // Try to create a test iframe spawn message to offscreen
        var result = await new Promise(function(resolve) {
          setTimeout(function(){resolve('timeout')}, 2000);
          chrome.runtime.sendMessage({type: 'test_spawn_check'}, function(r) {
            resolve('response: ' + JSON.stringify(r));
          });
        });

        return JSON.stringify({
          hasOffscreen: hasOffscreen,
          offscreenMethods: offscreenMethods,
          msgTest: result
        });
      } catch(e) {
        return JSON.stringify({error: e.message});
      }
    })()
  `, true, "iframe-test");
  console.log("Offscreen/iframe test:", iframeTest);

  // Manually call ensureProcessor to see what happens
  const processorTest = await reval(swSession, `
    (async function(){
      try {
        // Try to get existing offscreen contexts
        var result = {};
        try {
          var contexts = await browser.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
          result.existingContexts = contexts.length;
        } catch(e) {
          result.contextError = e.message;
        }

        // Check browser.offscreen state
        try {
          var hasDoc = await browser.offscreen.hasDocument();
          result.hasDocument = hasDoc;
        } catch(e) {
          result.hasDocError = e.message;
        }

        return JSON.stringify(result);
      } catch(e) {
        return JSON.stringify({fatalError: e.message});
      }
    })()
  `, true, "processor-test");
  console.log("Processor/offscreen test:", processorTest);

  // Check 5s later what happened
  await sleep(5000);

  const storage5s = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify(r);})()",
    true
  );
  console.log("Storage 5s after:", storage5s);

  const allTargets5s = await getTargets();
  console.log("All targets 5s after:");
  allTargets5s.forEach(t => console.log(`  ${t.type}: ${t.url.slice(0, 80)}`));

  console.log("\nSW logs:", swLogs.filter(l => !l.startsWith("EXC:Error: Receiving end")).map(l => l.slice(0, 200)));

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
