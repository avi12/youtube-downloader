// Check if the download iframe is being spawned and if DownloadIframeReady fires
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
type Target = { type: string; url: string; id: string; webSocketDebuggerUrl: string; parentId?: string };
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
      console.log(`[SW LOG] ${msg.slice(0, 300)}`);
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

  // Record targets BEFORE download click
  const targetsBefore = await getTargets();
  console.log("Targets before download:", targetsBefore.map(t => `${t.type}: ${t.url.slice(0,80)}`).join("\n  "));

  // Click download (use stored state from previous run - queue already has 1 item)
  // First check current queue state
  const storagePre = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue']);return JSON.stringify({q:r.videoQueue?r.videoQueue.length:0,items:r.videoQueue});})()",
    true
  );
  console.log("\nCurrent queue:", storagePre);

  // Clear and restart with a fresh download
  // Clear queue
  await reval(swSession,
    "(async function(){await chrome.storage.local.set({videoQueue:[],statusProgress:{},videoDetails:{}});})()",
    true
  );

  // Clear selections on page
  await reval(pageSession,
    "Array.from(document.querySelectorAll('tp-yt-paper-checkbox[aria-label=\"Select for download\"]')).filter(function(cb){return cb.getAttribute('aria-checked')==='true'}).forEach(function(cb){cb.removeAttribute('checked');cb.setAttribute('aria-checked','false');cb.dispatchEvent(new Event('change',{bubbles:true}));})",
    false
  );
  await sleep(300);

  // Select item 2
  const selectResult = await reval(pageSession,
    "(function(){ var items=Array.from(document.querySelectorAll('ytd-playlist-video-renderer'));var item=items[1];if(!item)return JSON.stringify({error:'not found'});var cb=item.querySelector('tp-yt-paper-checkbox[aria-label=\"Select for download\"]');if(!cb)return JSON.stringify({error:'no checkbox'});cb.click();return JSON.stringify({title:item.querySelector('a#video-title')&&item.querySelector('a#video-title').textContent.trim().slice(0,60)}); })()",
    false
  );
  console.log("Selected:", selectResult);
  await sleep(400);

  // Set Separate files
  await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){return b.getAttribute('aria-label')==='Separate files'});if(btn)btn.click();})()",
    false
  );
  await sleep(300);

  // Click download
  const dlResult = await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){var label=b.getAttribute('aria-label')||'';return label.toLowerCase().indexOf('download')===0&&label.toLowerCase().indexOf('whole')===-1});if(!btn)return JSON.stringify({notFound:true});btn.click();return JSON.stringify({clicked:true,label:btn.getAttribute('aria-label')})})()",
    false
  );
  console.log("Download click:", dlResult);

  // Wait 2s then check for new tabs/targets
  await sleep(2000);

  const targetsAfter2s = await getTargets();
  console.log("\nTargets 2s after download click:");
  targetsAfter2s.forEach(t => {
    const isNew = !targetsBefore.find(tb => tb.id === t.id);
    const marker = isNew ? " [NEW]" : "";
    console.log(`  ${t.type}: ${t.url.slice(0,80)}${marker}`);
  });

  // Check SW logs and storage
  const storage2s = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify(r);})()",
    true
  );
  console.log("Storage 2s after click:", storage2s);

  // Wait 15s to see if iframe appears
  await sleep(5000);

  const targetsAfter7s = await getTargets();
  console.log("\nTargets 7s after download click:");
  targetsAfter7s.forEach(t => {
    const isNew = !targetsBefore.find(tb => tb.id === t.id);
    const marker = isNew ? " [NEW]" : "";
    console.log(`  ${t.type}: ${t.url.slice(0,80)}${marker}`);
  });

  // Wait more
  await sleep(25000);

  const targetsAfter32s = await getTargets();
  console.log("\nTargets 32s after download click:");
  targetsAfter32s.forEach(t => {
    const isNew = !targetsBefore.find(tb => tb.id === t.id);
    const marker = isNew ? " [NEW]" : "";
    console.log(`  ${t.type}: ${t.url.slice(0,80)}${marker}`);
  });

  const finalStorage = await reval(swSession,
    "(async function(){var r=await chrome.storage.local.get(['videoQueue','statusProgress']);return JSON.stringify(r);})()",
    true
  );
  console.log("Final storage:", finalStorage);

  console.log("\n=== SW LOGS ===");
  swLogs.forEach(l => console.log(" ", l.slice(0, 300)));

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
