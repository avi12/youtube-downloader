// Test: does new Worker() with wrong URL throw or hang?
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
  const offTarget = targets.find(t => t.url.includes("offscreen.html") && t.url.includes("iakm"));
  if (!offTarget) { console.error("No offscreen"); return; }

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
  });
  await oSession.send("Runtime.enable", {});

  // Check the actual URL the offscreen module is using for the worker
  const workerUrlCheck = await oSession.send("Runtime.evaluate", {
    expression: `(function(){
      // Replicate what the bundled code does
      var url = new URL('./ffmpeg-worker.ts', self.location.href);
      return JSON.stringify({
        selfHref: self.location.href,
        resolvedUrl: url.href
      });
    })()`,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Worker URL resolution:", workerUrlCheck.result.value);

  // Check if ffmpeg-worker.ts or similar chunk exists
  const allChunks = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      // Try to fetch the resolved worker URL
      var workerUrl = new URL('./ffmpeg-worker.ts', self.location.href).href;
      try {
        var resp = await fetch(workerUrl);
        return JSON.stringify({exists: resp.ok, status: resp.status, url: workerUrl});
      } catch(e) {
        return JSON.stringify({fetchError: String(e), url: workerUrl});
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Worker URL fetch test:", allChunks.result.value);

  // Check what chunks ARE available in the extension
  const chunkList = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      var chunkNames = ['mux-worker.js', 'ffmpeg-worker.js', 'offscreen-worker.js', 'worker.js'];
      var results = [];
      for (var i = 0; i < chunkNames.length; i++) {
        var url = chrome.runtime.getURL('/chunks/' + chunkNames[i]);
        try {
          var resp = await fetch(url);
          if (resp.ok) results.push({name: chunkNames[i], status: resp.status});
        } catch(e) {}
      }
      return JSON.stringify(results);
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Available worker chunks:", chunkList.result.value);

  // THE KEY TEST: does new Worker() with a bad URL throw or hang?
  console.log("\n=== Testing Worker with bad URL ===");
  const badWorkerTest = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      var badUrl = new URL('./ffmpeg-worker.ts', self.location.href).href;
      console.log('[worker-bad] URL:', badUrl);
      var threw = false;
      var worker;
      try {
        worker = new Worker(badUrl, {type: 'module'});
        console.log('[worker-bad] Worker() did NOT throw');
      } catch(e) {
        threw = true;
        console.log('[worker-bad] Worker() THREW:', String(e));
        return JSON.stringify({threw: true, error: String(e)});
      }

      // Now test: does the Worker immediately fire an error event?
      var errorResult = await new Promise(function(resolve) {
        setTimeout(function(){resolve('no-error-after-3s');}, 3000);
        worker.onerror = function(e) {
          resolve(JSON.stringify({workerError: e.message, filename: e.filename, lineno: e.lineno}));
        };
        worker.onmessageerror = function(e) {
          resolve(JSON.stringify({msgError: String(e)}));
        };
      });
      console.log('[worker-bad] error result:', errorResult);
      worker.terminate();
      return JSON.stringify({threw: false, errorResult: errorResult});
    })()`,
    awaitPromise: true,
    returnByValue: true,
    timeout: 10000
  }) as { result: { value: string } };
  console.log("Bad worker test:", badWorkerTest.result.value);

  // Now test client.load() with a bad worker - does it hang?
  console.log("\n=== Testing FFmpegWorkerClient.load() with bad worker ===");
  const clientLoadTest = await oSession.send("Runtime.evaluate", {
    expression: `(async function(){
      var url = chrome.runtime.getURL('/chunks/recent-downloads-db-Bw4XdKg2.js');
      var mod = await import(url);
      var FFmpegWorkerClient = mod.j; // Be = j in exports?
      console.log('[client-load] mod keys:', JSON.stringify(Object.keys(mod)));

      // Get the FFmpegWorkerClient
      if (!FFmpegWorkerClient) {
        console.log('[client-load] FFmpegWorkerClient not found in shared bundle');
        // Try importing from offscreen bundle - but it's stuck evaluating
        // Try mux-worker directly
        var muxUrl = chrome.runtime.getURL('/chunks/mux-worker.js');
        console.log('[client-load] mux-worker URL:', muxUrl);
        return JSON.stringify({noFFmpegClient: true});
      }
      return JSON.stringify({found: typeof FFmpegWorkerClient});
    })()`,
    awaitPromise: true,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Client load test:", clientLoadTest.result.value);

  await sleep(1000);
  console.log("All logs:", offLogs.slice(-10));

  oSession.close();
}

main().catch(console.error);
