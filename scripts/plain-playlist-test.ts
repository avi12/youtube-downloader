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
    if (label) console.error(`[Exception in ${label}]`, desc.slice(0, 200));
  }
  return r.result.value;
}

async function wakeSwAndGetSession(): Promise<Session | null> {
  // Wake SW from offscreen page (which has chrome.runtime access)
  const targets = await getTargets();
  const offscreen = targets.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (offscreen) {
    const oSession = await openSession(offscreen.webSocketDebuggerUrl);
    await oSession.send("Runtime.evaluate", {
      expression: "chrome.runtime.sendMessage({type:'WAKE'},function(){});'sent'",
      returnByValue: true
    });
    oSession.close();
  }

  // Wait for SW to appear
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const t = await getTargets();
    const sw = t.find(x => x.type === "service_worker" && x.url.includes("iakm"));
    if (sw) return openSession(sw.webSocketDebuggerUrl);
    await sleep(500);
  }
  return null;
}

async function main() {
  console.log("=== Waking SW ===");
  // Wake SW from offscreen page
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
  console.log("Targets:", targets.map(t => `${t.type}: ${t.url.slice(0, 60)}`).join("\n  "));

  const playlistPage = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!playlistPage) { console.error("Playlist tab not found"); return; }

  let swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!swTarget) {
    console.log("SW not active, trying to wake...");
    const swSess = await wakeSwAndGetSession();
    if (!swSess) { console.error("Could not wake SW"); }
    swSess?.close();
    await sleep(1000);
    const t2 = await getTargets();
    swTarget = t2.find(x => x.type === "service_worker" && x.url.includes("iakm"));
    if (!swTarget) { console.error("SW still not found after wake attempt"); return; }
  }

  console.log("SW:", swTarget.url);

  const pageSession = await openSession(playlistPage.webSocketDebuggerUrl);
  const swSession = await openSession(swTarget.webSocketDebuggerUrl);

  const swLogs: string[] = [];
  const swNetReqs: Array<{ url: string; method: string }> = [];
  const swNetResps: Array<{ url: string; status: number }> = [];

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
      console.log(`[SW LOG] ${msg.slice(0, 300)}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      const desc = exc?.exception?.description ?? exc?.text ?? "unknown";
      if (!desc.includes("Receiving end does not exist")) {
        swLogs.push("EXCEPTION: " + desc);
        console.log(`[SW EXC] ${desc.slice(0, 200)}`);
      }
    }
    if (event.method === "Network.requestWillBeSent") {
      const req = event.params?.request as { url: string; method: string } | undefined;
      if (req?.url.includes("googlevideo.com")) {
        swNetReqs.push({ url: req.url.slice(0, 150), method: req.method });
        console.log(`[SW REQ] ${req.method} ${req.url.slice(0, 120)}`);
      }
    }
    if (event.method === "Network.responseReceived") {
      const resp = event.params?.response as { url: string; status: number } | undefined;
      if (resp?.url.includes("googlevideo.com")) {
        swNetResps.push({ url: resp.url.slice(0, 100), status: resp.status });
        console.log(`[SW RESP] ${resp.status} ${resp.url.slice(0, 100)}`);
      }
    }
  });

  await swSession.send("Runtime.enable", {});
  await swSession.send("Network.enable", {});
  await pageSession.send("Network.enable", {});

  const storageInit = await reval(swSession,
    "(async function(){ var r=await chrome.storage.local.get(['videoQueue','statusProgress']); return JSON.stringify(r); })()",
    true, "storage-init"
  );
  console.log("Initial storage:", storageInit);

  // Clear existing selections
  console.log("\n=== Clearing selections ===");
  await reval(pageSession,
    "Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label=\"Select for download\"]')).filter(function(cb){return cb.getAttribute('aria-checked')==='true'}).forEach(function(cb){cb.removeAttribute('checked');cb.setAttribute('aria-checked','false');cb.dispatchEvent(new Event('change',{bubbles:true}));})",
    false, "clear-selections"
  );
  await sleep(400);

  // Select item 2 (index 1)
  console.log("=== Selecting item 2 ===");
  const selectResult = await reval(pageSession,
    "(function(){ var items=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));var item=items[1];if(!item)return JSON.stringify({error:'not found',count:items.length});var cb=item.querySelector('tp-yt-paper-checkbox[aria-label=\"Select for download\"]');if(!cb)return JSON.stringify({error:'no checkbox'});cb.click();return JSON.stringify({title:item.querySelector('a#video-title')&&item.querySelector('a#video-title').textContent.trim().slice(0,60),checked:cb.getAttribute('aria-checked')}); })()",
    false, "select-item2"
  );
  console.log("Selected:", selectResult);
  await sleep(500);

  const selCount = await reval(pageSession,
    "document.querySelector('.ytdl-selection-count')&&document.querySelector('.ytdl-selection-count').textContent.trim()",
    false, "sel-count"
  );
  console.log("Selection count:", selCount);

  // Set Separate files
  const sepResult = await reval(pageSession,
    "(function(){var allBtns=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));var btn=allBtns.find(function(b){return b.getAttribute('aria-label')==='Separate files'});if(!btn)return JSON.stringify({notFound:true});btn.click();return JSON.stringify({clicked:true})})()",
    false, "separate-files"
  );
  console.log("Separate files:", sepResult);
  await sleep(300);

  // Click download
  const dlResult = await reval(pageSession,
    "(function(){var allBtns=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));var btn=allBtns.find(function(b){var label=b.getAttribute('aria-label')||'';return label.toLowerCase().indexOf('download')===0&&label.toLowerCase().indexOf('whole')===-1});if(!btn)return JSON.stringify({notFound:true,labels:allBtns.map(function(b){return b.getAttribute('aria-label')}).filter(Boolean).slice(0,15)});btn.click();return JSON.stringify({clicked:true,label:btn.getAttribute('aria-label')})})()",
    false, "download-click"
  );
  console.log("Download click:", dlResult);

  await sleep(3000);

  const storageAfter = await reval(swSession,
    "(async function(){ var r=await chrome.storage.local.get(['videoQueue','statusProgress','videoDetails']); return JSON.stringify(r); })()",
    true, "storage-after"
  );
  console.log("Storage after click:", storageAfter);

  const itemStateImmediate = await reval(pageSession,
    "(function(){var el=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[1];var stateEl=el&&el.querySelector('[data-ytdl-download-state]');return JSON.stringify({title:el&&el.querySelector('a#video-title')&&el.querySelector('a#video-title').textContent.trim().slice(0,50),state:stateEl&&stateEl.getAttribute('data-ytdl-download-state')})})()",
    false, "item-state-immediate"
  );
  console.log("Item state (immediate):", itemStateImmediate);

  // Poll
  console.log("\n=== Polling (70s) ===");
  const pollStart = Date.now();
  for (let tick = 0; tick < 35; tick++) {
    await sleep(2000);
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    const state = await reval(swSession,
      "(async function(){ var r=await chrome.storage.local.get(['videoQueue','statusProgress']); return JSON.stringify({q:r.videoQueue?r.videoQueue.length:0,p:r.statusProgress||{}}); })()",
      true
    );
    const parsed = JSON.parse(state) as { q: number; p: Record<string, unknown> };
    const { q, p } = parsed;
    console.log(`[${elapsed}s] queue=${q} progress keys=${JSON.stringify(Object.keys(p))}`);
    if (Object.keys(p).length > 0) console.log("  values:", JSON.stringify(p).slice(0, 400));
    if (q === 0 && Object.keys(p).length === 0 && tick > 3) {
      console.log("Queue cleared.");
      break;
    }
  }

  const dlCheck = await reval(swSession,
    "(async function(){var dl=await chrome.downloads.search({limit:3,orderBy:['-startTime']});return JSON.stringify(dl.map(function(d){return{filename:(d.filename||'').split('\\\\').pop(),state:d.state,fileSize:d.fileSize,error:d.error}}))})()",
    true
  );
  console.log("\nRecent downloads:", dlCheck);

  const finalItemStates = await reval(pageSession,
    "(function(){return JSON.stringify([1].map(function(i){var el=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[i];var stateEl=el&&el.querySelector('[data-ytdl-download-state]');return{i:i,title:el&&el.querySelector('a#video-title')&&el.querySelector('a#video-title').textContent.trim().slice(0,50),state:stateEl&&stateEl.getAttribute('data-ytdl-download-state')}}))})()",
    false
  );
  console.log("Final item states:", finalItemStates);

  console.log("\n=== SW LOG SUMMARY ===");
  swLogs.forEach(l => console.log(" ", l.slice(0, 200)));

  console.log("\n=== NETWORK SUMMARY ===");
  console.log(`SW googlevideo requests: ${swNetReqs.length}`);
  swNetReqs.forEach(r => console.log(`  ${r.method} ${r.url}`));
  console.log(`SW googlevideo responses: ${swNetResps.length}`);
  swNetResps.forEach(r => console.log(`  ${r.status} ${r.url}`));

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
