// Trace what happens in the SW after download is triggered
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
  const offscreen = targets0.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (offscreen) {
    const oSession = await openSession(offscreen.webSocketDebuggerUrl);
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

  const allSwEvents: string[] = [];
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
      allSwEvents.push(`LOG: ${msg}`);
      console.log(`[SW] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string; url?: string; lineNumber?: number } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      allSwEvents.push(`EXC@${(event.params?.exceptionDetails as {url?:string})?.url?.slice(-30)||'?'}:${desc.slice(0, 100)}`);
      if (!desc.includes("Receiving end does not exist") && !desc.includes("Could not establish connection")) {
        console.log(`[SW EXC] ${desc.slice(0, 250)}`);
      }
    }
  });

  await swSession.send("Runtime.enable", {});

  // Inject debugging into the SW to trace the dispatch flow
  const injectResult = await reval(swSession, `
    (async function(){
      // Check what browser.tabs.create does
      var origCreate = browser&&browser.tabs&&browser.tabs.create;
      if(origCreate && !window.__ytdlTraceInstalled) {
        window.__ytdlTraceInstalled = true;
        browser.tabs.create = async function(opts) {
          console.log('[TRACE] browser.tabs.create called with:', JSON.stringify(opts).slice(0,200));
          var result = await origCreate(opts);
          console.log('[TRACE] browser.tabs.create result:', JSON.stringify(result).slice(0,100));
          return result;
        };
      }
      // Check current registered handlers
      return JSON.stringify({
        hasBrowserTabs: typeof browser !== 'undefined' && typeof browser.tabs !== 'undefined',
        hasChromeTabs: typeof chrome !== 'undefined' && typeof chrome.tabs !== 'undefined',
        traceInstalled: !!window.__ytdlTraceInstalled
      });
    })()
  `, true, "inject-trace");
  console.log("SW trace inject:", injectResult);

  // Also check iframe host state
  const iframeHostCheck = await reval(swSession, `
    (async function(){
      // Check if there are any hosted iframes
      try {
        var tabs = await browser.tabs.query({});
        return JSON.stringify({tabCount: tabs.length, urls: tabs.map(function(t){return t.url}).slice(0,10)});
      } catch(e) {
        return JSON.stringify({error: e.message});
      }
    })()
  `, true, "tabs-check");
  console.log("Current tabs:", iframeHostCheck);

  // Check storage state
  const storageCheck = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify(r);})()",
    true
  );
  console.log("Current storage:", storageCheck);

  // Clear any stuck queue
  await reval(swSession,
    "(async function(){await chrome.storage.local.set({videoQueue:[],statusProgress:{},videoDetails:{},ytdl_checked_playlist_videos:{}});})()",
    true
  );

  // Prepare for download
  await reval(pageSession,
    "Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label=\"Select for download\"]')).filter(function(cb){return cb.getAttribute('aria-checked')==='true'}).forEach(function(cb){cb.removeAttribute('checked');cb.setAttribute('aria-checked','false');cb.dispatchEvent(new Event('change',{bubbles:true}));})",
    false
  );
  await sleep(300);

  await reval(pageSession,
    "(function(){ var items=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));var item=items[1];if(!item)return;var cb=item.querySelector('tp-yt-paper-checkbox[aria-label=\"Select for download\"]');if(cb)cb.click(); })()",
    false
  );
  await sleep(400);

  await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){return b.getAttribute('aria-label')==='Separate files'});if(btn)btn.click();})()",
    false
  );
  await sleep(300);

  const dlResult = await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){var label=b.getAttribute('aria-label')||'';return label.toLowerCase().indexOf('download')===0&&label.toLowerCase().indexOf('whole')===-1});if(!btn)return JSON.stringify({notFound:true});btn.click();return JSON.stringify({clicked:true,label:btn.getAttribute('aria-label')})})()",
    false, "dl-click"
  );
  console.log("Download click:", dlResult);

  // Wait and monitor
  await sleep(15000);

  const finalStorage = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify(r);})()",
    true
  );
  console.log("Storage after 15s:", finalStorage);

  // Check tabs
  const tabsAfter = await reval(swSession, `
    (async function(){
      try {
        var tabs = await browser.tabs.query({});
        return JSON.stringify({tabCount: tabs.length, ytUrls: tabs.filter(function(t){return t.url&&t.url.includes('youtube')}).map(function(t){return t.url})});
      } catch(e) {
        return JSON.stringify({error: e.message});
      }
    })()
  `, true, "tabs-after");
  console.log("Tabs after 15s:", tabsAfter);

  console.log("\n=== ALL SW EVENTS ===");
  allSwEvents.forEach(e => console.log(" ", e.slice(0, 300)));

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
