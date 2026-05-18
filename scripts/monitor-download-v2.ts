import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const sw = targets.find(t => t.type === "service_worker" && t.url?.includes(CHROME_EXT_ID));
if (!sw) { console.log("No SW"); process.exit(1); }

async function evalInSW(expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(sw!.webSocketDebuggerUrl!);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) { socket.close(); resolve(msg.result?.result?.value ?? '?'); }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 10000);
  });
}

// Monitor SW console
const consoleSocket = new WebSocket(sw.webSocketDebuggerUrl!);
consoleSocket.on("open", () => {
  consoleSocket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
  consoleSocket.send(JSON.stringify({ id: 2, method: "Console.enable" }));
});

const swLogs: string[] = [];
consoleSocket.on("message", (raw: Buffer) => {
  const msg = JSON.parse(String(raw));
  if (msg.method === "Console.messageAdded") {
    const text = msg.params.message.text;
    if (text.includes("ytdl") || text.includes("ycXjF91o73I") || text.includes("SABR") || text.includes("CDN") || text.includes("Array buffer")) {
      swLogs.push(text);
    }
  }
});

const startTime = Date.now();

async function check() {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  
  const opfs = await evalInSW(`
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
  `);
  
  const downloads = await evalInSW(`
    (async () => {
      const items = await chrome.downloads.search({ limit: 3, orderBy: ['-startTime'] });
      return items.map(d => {
        const n = d.filename.split(/[\/]/).pop() ?? '';
        return n.slice(0,50) + '|' + d.state + '|' + d.mime;
      }).join(' / ');
    })()
  `);
  
  console.log(`[${elapsed}s] OPFS: ${opfs}`);
  console.log(`[${elapsed}s] DL: ${downloads}`);
  if (swLogs.length > 0) {
    for (const log of swLogs) {
      console.log(`[${elapsed}s][SW] ${log}`);
    }
    swLogs.length = 0;
  }
}

// Poll every 30s for 10 minutes
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 30000));
  await check();
}

consoleSocket.close();
