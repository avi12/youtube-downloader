// Fresh clean test: clear all storage, reload page, then test
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
  // Wake SW and clear all state
  console.log("=== Step 1: Wake SW and clear state ===");
  const targets0 = await getTargets();
  const offscreen0 = targets0.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (offscreen0) {
    const oSession = await openSession(offscreen0.webSocketDebuggerUrl);
    await oSession.send("Runtime.evaluate", { expression: "chrome.runtime.sendMessage({type:'WAKE'},function(){});'sent'", returnByValue: true });
    oSession.close();
  }
  await sleep(2000);

  let targets1 = await getTargets();
  let swTarget = targets1.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!swTarget) { console.error("SW not found"); return; }

  const swSession = await openSession(swTarget.webSocketDebuggerUrl);

  // Clear ALL storage
  await reval(swSession, `
    (async function(){
      var allKeys = await chrome.storage.local.get(null);
      var keysToReset = ['videoQueue','statusProgress','videoDetails','ytdl-checked-playlist-videos','local:isFFmpegReady'];
      var reset = {};
      keysToReset.forEach(function(k){reset[k]=null;});
      // Actually use removeItem to fully remove them
      await chrome.storage.local.remove(keysToReset);
      console.log('[CLEAN] Storage cleared');
    })()
  `, true);
  await sleep(500);

  // Verify storage is clean
  const storageCheck = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress','videoDetails']);return JSON.stringify(r);})()",
    true
  );
  console.log("Storage after clear:", storageCheck);

  swSession.close();

  // Reload the playlist page
  console.log("\n=== Step 2: Reload playlist page ===");
  const targets2 = await getTargets();
  const playlistPage2 = targets2.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!playlistPage2) { console.error("Playlist page not found"); return; }

  const pSession2 = await openSession(playlistPage2.webSocketDebuggerUrl);
  await pSession2.send("Page.reload", {});
  pSession2.close();
  console.log("Reload triggered");
  await sleep(10000);

  // Wake SW again (page reload may have killed it)
  console.log("\n=== Step 3: Wake SW again ===");
  const targets3 = await getTargets();
  const offscreen3 = targets3.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (offscreen3) {
    const oSession3 = await openSession(offscreen3.webSocketDebuggerUrl);
    await oSession3.send("Runtime.evaluate", { expression: "chrome.runtime.sendMessage({type:'WAKE'},function(){});'sent'", returnByValue: true });
    oSession3.close();
    console.log("Wake sent from offscreen");
  }
  await sleep(2000);

  const targets4 = await getTargets();
  const playlistPage = targets4.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  swTarget = targets4.find(t => t.type === "service_worker" && t.url.includes("iakm"));

  if (!playlistPage) { console.error("Playlist page not found after reload"); return; }
  if (!swTarget) { console.error("SW not found after reload"); return; }

  const pageSession = await openSession(playlistPage.webSocketDebuggerUrl);
  const swSession2 = await openSession(swTarget.webSocketDebuggerUrl);

  // Wait for page to be fully rendered
  await sleep(5000);

  const readyState = await reval(pageSession, "document.readyState");
  console.log("Page readyState:", readyState);

  // Collect logs and events
  const swLogs: string[] = [];
  const swNetReqs: Array<{ url: string; method: string }> = [];
  const swNetResps: Array<{ url: string; status: number }> = [];

  swSession2.onEvent((ev: unknown) => {
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

  await swSession2.send("Runtime.enable", {});
  await swSession2.send("Network.enable", {});
  await pageSession.send("Network.enable", {});

  // Verify initial state
  const initialStorage = await reval(swSession2,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify(r);})()",
    true
  );
  console.log("Initial storage (should be empty):", initialStorage);

  const buttons = await reval(pageSession,
    "JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(function(b){return b.getAttribute('aria-label')}).filter(Boolean))",
    false
  );
  console.log("Buttons:", buttons);

  // Record all targets before
  const targetsBefore = await getTargets();

  console.log("\n=== Step 4: Select item 2 and download ===");

  // Clear checkboxes
  await reval(pageSession,
    "Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label=\"Select for download\"]')).filter(function(cb){return cb.getAttribute('aria-checked')==='true'}).forEach(function(cb){cb.removeAttribute('checked');cb.setAttribute('aria-checked','false');cb.dispatchEvent(new Event('change',{bubbles:true}));})",
    false
  );
  await sleep(400);

  // Select item 2
  const selectResult = await reval(pageSession,
    "(function(){var item=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[1];if(!item)return JSON.stringify({error:'not found'});var cb=item.querySelector('tp-yt-paper-checkbox[aria-label=\"Select for download\"]');if(!cb)return JSON.stringify({error:'no cb'});cb.click();return JSON.stringify({title:item.querySelector('a#video-title')&&item.querySelector('a#video-title').textContent.trim().slice(0,60)}); })()",
    false, "select"
  );
  console.log("Selected:", selectResult);
  await sleep(500);

  const selCount = await reval(pageSession,
    "document.querySelector('.ytdl-selection-count')&&document.querySelector('.ytdl-selection-count').textContent.trim()",
    false
  );
  console.log("Selection count:", selCount);

  // Set Separate files
  await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){return b.getAttribute('aria-label')==='Separate files'});if(btn)btn.click();})()",
    false
  );
  await sleep(300);

  const btnsBeforeClick = await reval(pageSession,
    "JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(function(b){return b.getAttribute('aria-label')}).filter(Boolean))",
    false
  );
  console.log("Buttons before click:", btnsBeforeClick);

  // Click download - ONLY if button says "Download N video(s)" not "Downloading"
  const dlResult = await reval(pageSession,
    "(function(){var allBtns=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button'));var btn=allBtns.find(function(b){var label=b.getAttribute('aria-label')||'';return label.toLowerCase().startsWith('download ')&&!label.toLowerCase().includes('whole')&&!label.toLowerCase().startsWith('downloading')});if(!btn)return JSON.stringify({notFound:true,labels:allBtns.map(function(b){return b.getAttribute('aria-label')}).filter(Boolean)});btn.click();return JSON.stringify({clicked:true,label:btn.getAttribute('aria-label')})})()",
    false, "download-click"
  );
  console.log("Download click:", dlResult);

  await sleep(3000);

  const storage3s = await reval(swSession2,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress','videoDetails']);return JSON.stringify(r);})()",
    true
  );
  console.log("Storage 3s:", storage3s);

  const newTargets3s = (await getTargets()).filter(t => !targetsBefore.find(tb => tb.id === t.id));
  console.log("New targets 3s:", newTargets3s.map(t => `${t.type}:${t.url}`));

  const itemState3s = await reval(pageSession,
    "(function(){var el=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[1];var stateEl=el&&el.querySelector('[data-ytdl-download-state]');return JSON.stringify({title:el&&el.querySelector('a#video-title')&&el.querySelector('a#video-title').textContent.trim().slice(0,50),state:stateEl&&stateEl.getAttribute('data-ytdl-download-state')})})()",
    false
  );
  console.log("Item state 3s:", itemState3s);

  // Poll
  console.log("\n=== Polling (70s) ===");
  const pollStart = Date.now();
  for (let tick = 0; tick < 35; tick++) {
    await sleep(2000);
    const elapsed = Math.round((Date.now() - pollStart) / 1000);
    const state = await reval(swSession2,
      "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify({q:r.videoQueue?r.videoQueue.length:0,p:r.statusProgress||{}});})()",
      true
    );
    const parsed = JSON.parse(state) as { q: number; p: Record<string, unknown> };
    const keys = Object.keys(parsed.p);
    console.log(`[${elapsed}s] queue=${parsed.q} progress=${JSON.stringify(keys)}`);
    if (keys.length > 0) console.log("  values:", JSON.stringify(parsed.p).slice(0, 400));

    // Check for new targets
    if (tick % 5 === 0) {
      const currentTargets = await getTargets();
      const newOnes = currentTargets.filter(t => !targetsBefore.find(tb => tb.id === t.id));
      if (newOnes.length > 0) console.log("  [NEW]:", newOnes.map(t => `${t.type}:${t.url.slice(0,80)}`).join(", "));
    }

    if (parsed.q === 0 && keys.length === 0 && tick > 3) {
      console.log("Done");
      break;
    }
  }

  const dlCheck = await reval(swSession2,
    "(async function(){var dl=await chrome.downloads.search({limit:3,orderBy:['-startTime']});return JSON.stringify(dl.map(function(d){return{filename:(d.filename||'').split('\\\\').pop(),state:d.state,fileSize:d.fileSize,error:d.error}}))})()",
    true
  );
  console.log("\nRecent downloads:", dlCheck);

  const finalItemState = await reval(pageSession,
    "(function(){return JSON.stringify([0,1,2].map(function(i){var el=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[i];var stateEl=el&&el.querySelector('[data-ytdl-download-state]');return{i:i,title:el&&el.querySelector('a#video-title')&&el.querySelector('a#video-title').textContent.trim().slice(0,50),state:stateEl&&stateEl.getAttribute('data-ytdl-download-state')}}))})()",
    false
  );
  console.log("Final item states:", finalItemState);

  console.log("\n=== SW LOGS ===");
  swLogs.forEach(l => console.log("  ", l.slice(0, 300)));

  console.log("\n=== NETWORK ===");
  console.log(`SW googlevideo requests: ${swNetReqs.length}`);
  swNetReqs.forEach(r => console.log(`  ${r.method} ${r.url}`));
  console.log(`SW googlevideo responses: ${swNetResps.length}`);
  swNetResps.forEach(r => console.log(`  ${r.status} ${r.url}`));

  pageSession.close();
  swSession2.close();
}

main().catch(console.error);
