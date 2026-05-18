import { findExtensionTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const muxWorker = targets.find(t => t.type === "worker" && t.url?.includes(CHROME_EXT_ID));
const offscreen = targets.find(t => t.type === "background_page" && t.url?.includes(CHROME_EXT_ID));

if (!muxWorker) {
  console.log("Mux worker not found!");
  process.exit(1);
}

console.log("Mux worker:", muxWorker.url);
console.log("Offscreen:", offscreen?.url ?? "not found");

// Listen to console events from mux worker for 10 seconds
const recentLogs: string[] = [];

await new Promise<void>((resolve) => {
  const socket = new WebSocket(muxWorker.webSocketDebuggerUrl!);
  let msgId = 1;
  
  socket.on("open", () => {
    // Enable runtime
    socket.send(JSON.stringify({ id: msgId++, method: "Runtime.enable" }));
    // Enable console
    socket.send(JSON.stringify({ id: msgId++, method: "Console.enable" }));
    // Also check OPFS
    socket.send(JSON.stringify({ 
      id: 99, 
      method: "Runtime.evaluate", 
      params: { 
        expression: `
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
        `,
        awaitPromise: true,
        returnByValue: true
      }
    }));
  });
  
  socket.on("message", (raw: Buffer) => {
    const msg = JSON.parse(String(raw));
    if (msg.method === "Console.messageAdded") {
      recentLogs.push(`[${msg.params.message.level}] ${msg.params.message.text}`);
    }
    if (msg.id === 99) {
      console.log("Mux worker OPFS:", msg.result?.result?.value);
    }
  });
  
  setTimeout(() => {
    socket.close();
    resolve();
  }, 5000);
});

console.log("Recent mux worker logs:", recentLogs.length > 0 ? recentLogs.join('\n') : "none");

// Check offscreen for recent errors
if (offscreen) {
  const offRecentLogs: string[] = [];
  await new Promise<void>((resolve) => {
    const socket = new WebSocket(offscreen.webSocketDebuggerUrl!);
    let msgId = 1;
    
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: msgId++, method: "Runtime.enable" }));
      socket.send(JSON.stringify({ id: msgId++, method: "Console.enable" }));
    });
    
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "Console.messageAdded") {
        offRecentLogs.push(`[${msg.params.message.level}] ${msg.params.message.text}`);
      }
    });
    
    setTimeout(() => {
      socket.close();
      resolve();
    }, 3000);
  });
  
  console.log("Recent offscreen logs:", offRecentLogs.length > 0 ? offRecentLogs.join('\n') : "none");
}
