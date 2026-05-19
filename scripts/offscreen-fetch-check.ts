// Test: does fetch hang in the offscreen context for WASM URL?
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

async function getTargets() {
  return (await fetch(`${CDP_URL}/json`).then(r => r.json())) as Target[];
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
  const swTarget = targets.find(t => t.type === "service_worker" && t.url.includes("iakm"));
  if (!swTarget) { console.error("SW not found"); return; }
  const swSession = await openSession(swTarget.webSocketDebuggerUrl);
  await swSession.send("Runtime.enable", {});

  // Get existing offscreen
  const offTarget = targets.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (!offTarget) { console.error("No offscreen"); swSession.close(); return; }

  const oSession = await openSession(offTarget.webSocketDebuggerUrl);
  const offLogs: string[] = [];
  oSession.onEvent((ev: unknown) => {
    const event = ev as { method?: string; params?: unknown };
    if (event.method === "Runtime.consoleAPICalled") {
      const args = (event.params as { args?: Array<{ value?: unknown; description?: string }> }).args ?? [];
      const msg = args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? "[obj]")).join(" ");
      offLogs.push(msg);
      console.log(`[OFF ${new Date().toISOString().slice(11,23)}] ${msg}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      console.log("!!! EXCEPTION:", JSON.stringify(event.params).slice(0, 500));
    }
    if (event.method === "Network.responseReceived") {
      const p = event.params as { response?: { url: string; status: number } };
      console.log(`NET: ${p.response?.status} ${(p.response?.url ?? "").slice(-80)}`);
    }
    if (event.method === "Network.loadingFailed") {
      console.log("NET FAIL:", JSON.stringify(event.params).slice(0, 300));
    }
  });
  await oSession.send("Runtime.enable", {});
  await oSession.send("Network.enable", {});

  console.log("=== Test 1: fetch WASM URL from offscreen ===");
  const fetchTest = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      try {
        var wasmUrl = chrome.runtime.getURL('/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
        console.log('[fetch-test] URL:', wasmUrl);
        console.log('[fetch-test] starting fetch...');
        var startMs = Date.now();
        var resp = await Promise.race([
          fetch(wasmUrl),
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('TIMEOUT_5S')); }, 5000); })
        ]);
        console.log('[fetch-test] fetch done in ' + (Date.now()-startMs) + 'ms, status:', resp.status, 'ok:', resp.ok);
        console.log('[fetch-test] reading arrayBuffer...');
        var buf = await Promise.race([
          resp.arrayBuffer(),
          new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('ARRAYBUFFER_TIMEOUT')); }, 30000); })
        ]);
        console.log('[fetch-test] arrayBuffer done:', buf.byteLength, 'bytes');
        return JSON.stringify({ok: true, status: resp.status, size: buf.byteLength});
      } catch(e) {
        console.log('[fetch-test] ERROR:', String(e));
        return JSON.stringify({error: String(e)});
      }
    })()`,
    awaitPromise: true,
    returnByValue: true,
    timeout: 40000
  }) as { result: { value: string } };
  console.log("Fetch test result:", fetchTest.result.value);

  await sleep(1000);

  // Test 2: new Worker from offscreen - does it hang?
  console.log("\n=== Test 2: create Worker ===");
  const workerTest = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      try {
        var workerUrl = new URL('./ffmpeg-worker.ts', chrome.runtime.getURL('/chunks/offscreen-BVNygspJ.js'));
        // Actually check what URL the bundle generates:
        var testUrl = new URL('./ffmpeg-worker.ts', self.location.href);
        console.log('[worker-test] worker URL would be:', testUrl.href);
        // Use the actual chunk URL format
        var chunkUrl = chrome.runtime.getURL('/chunks/mux-worker.js');
        console.log('[worker-test] mux-worker.js exists at:', chunkUrl);
        return JSON.stringify({workerUrl: testUrl.href, chunkUrl: chunkUrl});
      } catch(e) {
        console.log('[worker-test] error:', String(e));
        return JSON.stringify({error: String(e)});
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Worker test:", workerTest.result.value);

  await sleep(500);
  console.log("Logs:", offLogs);

  oSession.close();
  swSession.close();
}

main().catch(console.error);
