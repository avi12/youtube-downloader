// Detailed debugging: intercept message passing on download click
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
type EvalResult = { result: { value: string; type?: string; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } };

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
  // Wake SW from offscreen
  const targets0 = await getTargets();
  const offscreen0 = targets0.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (offscreen0) {
    const oSession0 = await openSession(offscreen0.webSocketDebuggerUrl);
    await oSession0.send("Runtime.evaluate", {
      expression: "chrome.runtime.sendMessage({type:'WAKE'},function(){});'sent'",
      returnByValue: true
    });
    oSession0.close();
  }
  await sleep(2000);

  const targets = await getTargets();
  const playlistPage = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!playlistPage) { console.error("Playlist tab not found"); return; }
  const swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!swTarget) { console.error("SW not found"); return; }

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
      if (!desc.includes("Receiving end does not exist")) {
        swLogs.push("EXC:" + desc);
        console.log(`[SW EXC] ${desc.slice(0, 200)}`);
      }
    }
  });

  await swSession.send("Runtime.enable", {});

  // Inject a message interceptor into the page to see what chrome.runtime.sendMessage sends
  await pageSession.send("Runtime.enable", {});

  const pageLogs: string[] = [];
  pageSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: Record<string, unknown> };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      pageLogs.push(msg);
      console.log(`[PAGE] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "";
      if (!desc.includes("Receiving end does not exist")) {
        pageLogs.push("EXC:" + desc);
        console.log(`[PAGE EXC] ${desc.slice(0, 200)}`);
      }
    }
  });

  // Intercept sendMessage in the page
  const interceptResult = await reval(pageSession, `
    (function(){
      if(window.__ytdl_intercepted) return 'already intercepted';
      window.__ytdl_intercepted = true;
      var orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = function(msg, cb) {
        console.log('[INTERCEPT sendMessage]', JSON.stringify(msg).slice(0,200));
        return orig(msg, function(r) {
          console.log('[INTERCEPT response]', JSON.stringify(r).slice(0,200));
          if(cb) cb(r);
        });
      };
      return 'intercepted';
    })()
  `, false, "intercept");
  console.log("Intercept result:", interceptResult);

  // Select item 2
  await reval(pageSession,
    "Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label=\"Select for download\"]')).filter(function(cb){return cb.getAttribute('aria-checked')==='true'}).forEach(function(cb){cb.removeAttribute('checked');cb.setAttribute('aria-checked','false');cb.dispatchEvent(new Event('change',{bubbles:true}));})",
    false, "clear"
  );
  await sleep(300);

  const selectResult = await reval(pageSession,
    "(function(){ var items=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));var item=items[1];if(!item)return JSON.stringify({error:'not found'});var cb=item.querySelector('tp-yt-paper-checkbox[aria-label=\"Select for download\"]');if(!cb)return JSON.stringify({error:'no cb'});cb.click();return JSON.stringify({title:item.querySelector('a#video-title')&&item.querySelector('a#video-title').textContent.trim().slice(0,60)}); })()",
    false, "select"
  );
  console.log("Selected:", selectResult);
  await sleep(500);

  // Set Separate files
  await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){return b.getAttribute('aria-label')==='Separate files'});if(btn)btn.click();})()",
    false, "sep-files"
  );
  await sleep(300);

  // Check what buttons exist before clicking download
  const btnsBeforeClick = await reval(pageSession,
    "JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(function(b){return{label:b.getAttribute('aria-label'),disabled:b.disabled,aria:b.getAttribute('aria-disabled')}}))",
    false, "btns-check"
  );
  console.log("Buttons before click:", btnsBeforeClick);

  // Click download
  const dlResult = await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){var label=b.getAttribute('aria-label')||'';return label.toLowerCase().indexOf('download')===0&&label.toLowerCase().indexOf('whole')===-1});if(!btn)return JSON.stringify({notFound:true});btn.click();return JSON.stringify({clicked:true,label:btn.getAttribute('aria-label')})})()",
    false, "download-click"
  );
  console.log("Download click:", dlResult);

  // Wait for messages
  await sleep(5000);

  // Check what happened in the SW
  const swStorage = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress','videoDetails']);return JSON.stringify(r);})()",
    true
  );
  console.log("SW storage after click:", swStorage);

  // Check what's in the content scripts running on the page
  const contentScripts = await reval(pageSession,
    "(function(){ return JSON.stringify({ ytdlGlobal: typeof window.__ytdl !== 'undefined', ytdlStore: typeof window.__ytdlStore !== 'undefined', allKeys: Object.keys(window).filter(function(k){return k.includes('ytdl')}).slice(0,20) }); })()",
    false, "content-scripts"
  );
  console.log("Content script globals:", contentScripts);

  // Check for extension messages in page
  const extmsgs = await reval(pageSession,
    "JSON.stringify(pageLogs||[])",
    false
  );

  console.log("\nPage logs:", pageLogs.slice(0, 20).map(l => l.slice(0, 200)));
  console.log("\nSW logs:", swLogs.slice(0, 20).map(l => l.slice(0, 200)));

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
