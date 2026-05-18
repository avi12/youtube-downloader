import { findExtensionTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const muxWorker = targets.find(t => t.type === "worker" && t.url?.includes(CHROME_EXT_ID));
const offscreen = targets.find(t => t.type === "background_page" && t.url?.includes(CHROME_EXT_ID));

console.log("Mux worker:", muxWorker ? "found" : "not found");
console.log("Offscreen:", offscreen ? "found" : "not found");

async function evalIn(wsUrl: string, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) {
        socket.close();
        resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? JSON.stringify(msg.result));
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

if (muxWorker) {
  const muxState = await evalIn(muxWorker.webSocketDebuggerUrl!, `
    (() => {
      // Try to find active mux jobs
      const result = {};
      // Check known global variable names (minified code won't have these)
      if (typeof activeMuxJobs !== 'undefined') result.activeMuxJobs = [...activeMuxJobs.keys()];
      if (typeof pendingMuxJobs !== 'undefined') result.pendingMuxJobs = [...pendingMuxJobs.keys()];
      if (typeof currentJob !== 'undefined') result.currentJob = JSON.stringify(currentJob);
      return JSON.stringify(result);
    })()
  `);
  console.log("Mux worker state:", muxState);
}

if (offscreen) {
  const offState = await evalIn(offscreen.webSocketDebuggerUrl!, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      const files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push(name + ':' + (file.size / 1024 / 1024).toFixed(1) + 'MB');
        }
      }
      return 'OPFS: ' + (files.length ? files.join(', ') : 'empty');
    })()
  `);
  console.log("Offscreen OPFS:", offState);
}
