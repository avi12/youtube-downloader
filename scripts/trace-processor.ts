// Trace exactly where the download dispatch hangs
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
      if (!desc.includes("Receiving end does not exist") && !desc.includes("Could not establish connection")) {
        swLogs.push("EXC:" + desc);
        console.log(`[SW EXC] ${desc.slice(0, 200)}`);
      }
    }
  });
  await swSession.send("Runtime.enable", {});

  // Clear state
  await reval(swSession, "(async function(){await chrome.storage.local.remove(['videoQueue','statusProgress','videoDetails']);})()", true);
  await sleep(300);

  // Select item 2 on page
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

  const btns = await reval(pageSession,
    "JSON.stringify(Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(function(b){return b.getAttribute('aria-label')}).filter(Boolean))",
    false
  );
  console.log("Buttons:", btns);

  const dlResult = await reval(pageSession,
    "(function(){var btn=Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).find(function(b){var label=b.getAttribute('aria-label')||'';return label.toLowerCase().startsWith('download ')&&!label.toLowerCase().includes('whole')&&!label.toLowerCase().startsWith('downloading')});if(!btn)return JSON.stringify({notFound:true,btns:Array.from(document.querySelectorAll('[data-ytdl-playlist-downloader] button')).map(function(b){return b.getAttribute('aria-label')}).filter(Boolean)});btn.click();return JSON.stringify({clicked:true,label:btn.getAttribute('aria-label')})})()",
    false, "dl-click"
  );
  console.log("Click:", dlResult);

  await sleep(1000);

  // Now in the SW, manually call ensureProcessor to see what happens
  console.log("\n=== Testing ensureProcessor directly ===");
  const processorResult = await reval(swSession, `
    (async function(){
      console.log('[TEST] Starting ensureProcessor test');

      // Step 1: Check current offscreen state
      var hasDoc = false;
      try {
        hasDoc = await browser.offscreen.hasDocument();
      } catch(e) {
        console.log('[TEST] hasDocument error:', e.message);
      }
      console.log('[TEST] hasDocument before:', hasDoc);

      // Step 2: Close existing doc
      if(hasDoc) {
        try {
          await browser.offscreen.closeDocument();
          console.log('[TEST] closeDocument OK');
        } catch(e) {
          console.log('[TEST] closeDocument error:', e.message);
        }
      }

      // Step 3: Create new doc
      console.log('[TEST] Creating new offscreen doc');
      try {
        await browser.offscreen.createDocument({
          url: '/offscreen.html',
          reasons: [browser.offscreen.Reason.WORKERS],
          justification: 'test'
        });
        console.log('[TEST] createDocument OK');
      } catch(e) {
        console.log('[TEST] createDocument error:', e.message);
        return JSON.stringify({error: 'createDocument failed: ' + e.message});
      }

      console.log('[TEST] Waiting 5s for FFmpegReady...');
      return JSON.stringify({step: 'waiting for FFmpegReady'});
    })()
  `, true, "processor-test");
  console.log("Processor test result:", processorResult);

  // Wait for FFmpegReady
  await sleep(10000);

  // Check if new offscreen appeared
  const targetsAfter = await getTargets();
  const offscreenDoc = targetsAfter.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  console.log("\nOffscreen doc after:", offscreenDoc?.url, offscreenDoc?.type);

  if (offscreenDoc) {
    const oSession = await openSession(offscreenDoc.webSocketDebuggerUrl);
    const offLogs: string[] = [];
    oSession.onEvent((ev: unknown) => {
      const event = ev as { method?: string; params?: Record<string, unknown> };
      if (event.method === "Runtime.consoleAPICalled") {
        const args = (event.params?.args as Array<{ value?: unknown; description?: string }>) ?? [];
        const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
        offLogs.push(msg);
        console.log(`[OFFSCREEN] ${msg.slice(0, 200)}`);
      }
      if (event.method === "Runtime.exceptionThrown") {
        const exc = event.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
        const desc = exc?.exception?.description ?? exc?.text ?? "";
        offLogs.push("EXC:" + desc);
        console.log(`[OFFSCREEN EXC] ${desc.slice(0, 200)}`);
      }
    });
    await oSession.send("Runtime.enable", {});

    await sleep(3000);
    console.log("Offscreen logs during wait:", offLogs.length, offLogs.map(l => l.slice(0, 200)));

    const offGlobals = await reval(oSession, `
      (function(){
        return JSON.stringify({
          scripts: Array.from(document.querySelectorAll('script')).map(function(s){return s.src.slice(-40)}),
          iframes: document.querySelectorAll('iframe').length
        });
      })()
    `, false);
    console.log("Offscreen globals:", offGlobals);

    oSession.close();
  }

  console.log("\n=== SW LOGS ALL ===");
  swLogs.forEach(l => console.log("  ", l.slice(0, 300)));

  pageSession.close();
  swSession.close();
}

main().catch(console.error);
