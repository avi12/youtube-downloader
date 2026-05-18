import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const ytPage = targets.find(t => t.type === "page" && t.url?.includes("youtube.com/watch") && t.url?.includes("ycXjF91o73I"));
const sw = targets.find(t => t.type === "service_worker" && t.url?.includes(CHROME_EXT_ID));

if (!ytPage || !sw) { console.log("Targets not found"); process.exit(1); }

async function evalIn(wsUrl: string, expression: string, awaitPromise = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) { socket.close(); resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? '?'); }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

// First clean up old OPFS file
const cleanup = await evalIn(sw.webSocketDebuggerUrl!, `
  (async () => {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry('ycXjF91o73I-video-stream'); return 'cleaned'; }
    catch (e) { return 'not found: ' + e.message; }
  })()
`, true);
console.log("Cleanup:", cleanup);

// Listen to SW console for CDN logs
const swLogs: string[] = [];
const consoleSocket = new WebSocket(sw.webSocketDebuggerUrl!);
await new Promise<void>(resolve => {
  consoleSocket.on("open", () => {
    consoleSocket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    consoleSocket.send(JSON.stringify({ id: 2, method: "Console.enable" }));
    setTimeout(resolve, 500); // Wait for console to enable
  });
});

consoleSocket.on("message", (raw: Buffer) => {
  const msg = JSON.parse(String(raw));
  if (msg.method === "Console.messageAdded") {
    const text = msg.params.message.text;
    if (text.includes("ytdl:bg") || text.includes("ycXjF91o73I") || text.includes("CDN")) {
      swLogs.push(text);
    }
  }
});

// Click retry button
const clickResult = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (() => {
    const allBtns = document.querySelectorAll('button');
    const retryBtn = [...allBtns].find(b => b.textContent?.trim() === 'Retry download');
    if (retryBtn) { retryBtn.click(); return 'clicked retry'; }
    const dlBtn = [...allBtns].find(b => b.textContent?.trim() === 'Download' && !b.disabled);
    if (dlBtn) { dlBtn.click(); return 'clicked download'; }
    return 'no button found: ' + [...allBtns].filter(b => b.textContent?.trim().length > 0 && b.textContent!.trim().length < 30).map(b => b.textContent?.trim()).slice(0, 10).join(', ');
  })()
`);
console.log("Click:", clickResult);

// Wait 10 seconds to collect logs
await new Promise(r => setTimeout(r, 10000));

consoleSocket.close();
console.log("SW logs captured:", swLogs.length);
for (const log of swLogs) {
  console.log("  SW:", log);
}
