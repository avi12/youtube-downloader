import { findExtensionTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

// Get all targets including workers
const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

console.log("All targets:");
for (const t of targets) {
  console.log(`  [${t.type}] ${t.title || t.url?.slice(0, 80)}`);
}

const { serviceWorker } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

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

// Get recent SW console errors
const swErrors = await evalIn(serviceWorker!.webSocketDebuggerUrl!, `
  (() => {
    // Check for any recent logged errors using our known log pattern
    const logs = (typeof __recentLogs !== 'undefined') ? __recentLogs : [];
    return JSON.stringify(logs.slice(-20));
  })()
`);
console.log("SW recent logs:", swErrors);

// Check SW pending items
const swState = await evalIn(serviceWorker!.webSocketDebuggerUrl!, `
  (async () => {
    // Check OPFS
    const root = await navigator.storage.getDirectory();
    const files = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        files.push({ name, size: (file.size / 1024 / 1024).toFixed(1) + 'MB', lastModified: new Date(file.lastModified).toISOString() });
      }
    }
    return JSON.stringify(files);
  })()
`);
console.log("OPFS files:", swState);
