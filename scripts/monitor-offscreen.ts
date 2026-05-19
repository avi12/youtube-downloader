// Monitor offscreen page logs and trace the download flow
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
  const offscreenPage = targets.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));

  if (!playlistPage || !swTarget) { console.error("Missing targets"); return; }
  console.log("Offscreen page found:", !!offscreenPage);

  const pageSession = await openSession(playlistPage.webSocketDebuggerUrl);
  const swSession = await openSession(swTarget.webSocketDebuggerUrl);
  let offscreenSession: Session | null = offscreenPage ? await openSession(offscreenPage.webSocketDebuggerUrl) : null;

  const swLogs: string[] = [];
  const offscreenLogs: string[] = [];

  const setupEventMonitor = (session: Session, prefix: string, logs: string[]) => {
    session.onEvent((ev: unknown) => {
      const event = ev as { method?: string; params?: Record<string, unknown> };
      if (event.method === "Runtime.consoleAPICalled") {
        const args = (event.params?.args as Array<{ value?: unknown; description?: string; preview?: { properties?: Array<{name: string; value?: string}> } }>) ?? [];
        const msg = args.map(a => {
          if (a.value !== undefined) return String(a.value);
          if (a.description) return a.description;
          if (a.preview?.properties) return JSON.stringify(Object.fromEntries(a.preview.properties.map(p => [p.name, p.value])));
          return "[object]";
        }).join(" ");
        logs.push(msg);
        console.log(`[${prefix}] ${msg.slice(0, 300)}`);
      }
      if (event.method === "Runtime.exceptionThrown") {
        const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
        const desc = exc?.exception?.description ?? exc?.text ?? "";
        if (!desc.includes("Receiving end does not exist") && !desc.includes("Could not establish connection")) {
          logs.push("EXC:" + desc);
          console.log(`[${prefix} EXC] ${desc.slice(0, 200)}`);
        }
      }
    });
  };

  setupEventMonitor(swSession, "SW", swLogs);
  if (offscreenSession) setupEventMonitor(offscreenSession, "OFFSCREEN", offscreenLogs);

  await swSession.send("Runtime.enable", {});
  await swSession.send("Network.enable", {});
  if (offscreenSession) {
    await offscreenSession.send("Runtime.enable", {});
    await offscreenSession.send("Network.enable", {});
  }

  // Check SW state
  const swState = await reval(swSession, `
    (function(){
      return JSON.stringify({
        processorReady: typeof processorReady !== 'undefined' ? String(processorReady) : 'not in scope',
        resolveFFmpegReady: typeof resolveFFmpegReady !== 'undefined' ? String(resolveFFmpegReady) : 'not in scope'
      });
    })()
  `, false, "sw-state");
  console.log("SW internal state:", swState);

  // Check isFFmpegReadyItem value
  const ffmpegReady = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['isFFmpegReady','local:isFFmpegReady']);return JSON.stringify(r);})()",
    true
  );
  console.log("FFmpeg ready storage:", ffmpegReady);

  // Check storage
  const storageState = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify(r);})()",
    true
  );
  console.log("Storage state:", storageState);

  // Clear queue
  await reval(swSession,
    "(async function(){await chrome.storage.local.set({videoQueue:[],statusProgress:{},videoDetails:{}});})()",
    true
  );

  // Clear selections and trigger download
  await reval(pageSession,
    "Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label=\"Select for download\"]')).filter(function(cb){return cb.getAttribute('aria-checked')==='true'}).forEach(function(cb){cb.removeAttribute('checked');cb.setAttribute('aria-checked','false');cb.dispatchEvent(new Event('change',{bubbles:true}));})",
    false
  );
  await sleep(300);

  await reval(pageSession,
    "(function(){ var items=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));var item=items[1];if(item){var cb=item.querySelector('tp-yt-paper-checkbox[aria-label=\"Select for download\"]');if(cb)cb.click();} })()",
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
    false, "dl-click"
  );
  console.log("\nDownload click:", dlResult);

  // Watch for new offscreen pages being created
  const targetsBefore = await getTargets();

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const elapsed = (i + 1) * 2;

    // Check storage
    const state = await reval(swSession,
      "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify({q:r.videoQueue?r.videoQueue.length:0,p:r.statusProgress||{}});})()",
      true
    );
    const parsed = JSON.parse(state) as { q: number; p: Record<string, unknown> };
    console.log(`[${elapsed}s] queue=${parsed.q} progress=${JSON.stringify(Object.keys(parsed.p))}`);
    if (Object.keys(parsed.p).length > 0) console.log("  progress:", JSON.stringify(parsed.p).slice(0, 300));

    // Check for new targets
    const currentTargets = await getTargets();
    const newOnes = currentTargets.filter(t => !targetsBefore.find(tb => tb.id === t.id));
    if (newOnes.length > 0) {
      console.log("  [NEW TARGETS]:", newOnes.map(t => `${t.type}:${t.url}`).join(", "));
      // Connect to new offscreen if created
      const newOffscreen = newOnes.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
      if (newOffscreen && !offscreenSession) {
        offscreenSession = await openSession(newOffscreen.webSocketDebuggerUrl);
        setupEventMonitor(offscreenSession, "NEW-OFFSCREEN", offscreenLogs);
        await offscreenSession.send("Runtime.enable", {});
        console.log("  [Connected to new offscreen]");
      }
    }

    if (parsed.q === 0 && Object.keys(parsed.p).length === 0 && i > 3) {
      console.log("Done (queue empty)");
      break;
    }
  }

  const dlCheck = await reval(swSession,
    "(async function(){var dl=await chrome.downloads.search({limit:3,orderBy:['-startTime']});return JSON.stringify(dl.map(function(d){return{filename:(d.filename||'').split('\\\\').pop(),state:d.state,fileSize:d.fileSize,error:d.error}}))})()",
    true
  );
  console.log("\nRecent downloads:", dlCheck);

  const finalItemState = await reval(pageSession,
    "(function(){var el=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'))[1];var stateEl=el&&el.querySelector('[data-ytdl-download-state]');return JSON.stringify({title:el&&el.querySelector('a#video-title')&&el.querySelector('a#video-title').textContent.trim().slice(0,50),state:stateEl&&stateEl.getAttribute('data-ytdl-download-state')})})()",
    false
  );
  console.log("Final item state:", finalItemState);

  console.log("\n=== SW LOGS ===");
  swLogs.forEach(l => console.log("  SW:", l.slice(0, 300)));
  console.log("\n=== OFFSCREEN LOGS ===");
  offscreenLogs.forEach(l => console.log("  OF:", l.slice(0, 300)));

  pageSession.close();
  swSession.close();
  offscreenSession?.close();
}

main().catch(console.error);
