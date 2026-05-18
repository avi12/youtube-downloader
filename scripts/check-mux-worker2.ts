import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const muxWorker = targets.find(t => t.type === "worker" && t.url?.includes(CHROME_EXT_ID));
const offscreen = targets.find(t => t.type === "background_page" && t.url?.includes(CHROME_EXT_ID));

async function evalIn(wsUrl: string, expression: string, awaitPromise = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) {
        socket.close();
        if (msg.result?.exceptionDetails) {
          resolve("ERROR: " + JSON.stringify(msg.result.exceptionDetails));
        } else {
          resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? JSON.stringify(msg.result?.result));
        }
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

if (muxWorker) {
  console.log("--- Mux Worker State ---");
  
  // Check if FFmpeg is initialized in worker
  const ffmpegState = await evalIn(muxWorker.webSocketDebuggerUrl!, `
    JSON.stringify({
      selfName: self.name || 'unnamed',
      hasLocation: !!self.location,
      hasMsgHandler: typeof onmessage !== 'undefined',
      timestamp: Date.now()
    })
  `);
  console.log("Worker basic state:", ffmpegState);

  // Check OPFS from mux worker
  const muxOpfs = await evalIn(muxWorker.webSocketDebuggerUrl!, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      const files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push(name + ':' + (file.size / 1024 / 1024).toFixed(1) + 'MB');
        }
      }
      return files.length ? files.join(', ') : 'empty';
    })()
  `, true);
  console.log("Mux Worker OPFS:", muxOpfs);
}

if (offscreen) {
  console.log("--- Offscreen State ---");
  
  // Check if stream processor has active jobs  
  const offActive = await evalIn(offscreen.webSocketDebuggerUrl!, `
    (() => {
      // activeJobs is in stream-processor.ts - minified in build
      return JSON.stringify({
        timestamp: Date.now(),
        hasNavigatorStorage: !!navigator.storage
      });
    })()
  `);
  console.log("Offscreen basic state:", offActive);

  // Check OPFS from offscreen
  const offOpfs = await evalIn(offscreen.webSocketDebuggerUrl!, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      const files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push({ name, sizeMb: (file.size / 1024 / 1024).toFixed(1), lastModified: new Date(file.lastModified).toISOString() });
        }
      }
      return JSON.stringify(files);
    })()
  `, true);
  console.log("Offscreen OPFS detail:", offOpfs);
}
