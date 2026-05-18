import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const allTargets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const sw = allTargets.find(t => t.type === "service_worker" && t.url?.includes(CHROME_EXT_ID));
const ytPage = allTargets.find(t => t.type === "page" && t.url?.includes("ycXjF91o73I"));

if (!sw || !ytPage) { console.log("targets missing"); process.exit(1); }

async function evalIn(wsUrl: string, expression: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) { socket.close(); resolve(String(msg.result?.result?.value ?? '?')); }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 20000);
  });
}

// Patch SW to capture logs
const patchResult = await evalIn(sw.webSocketDebuggerUrl!, `
  (function() {
    if (!globalThis.__cdnLogs) globalThis.__cdnLogs = [];
    var origWarn = console.warn;
    console.warn = function() {
      var msg = Array.from(arguments).join(" ");
      if (msg.includes("CDN check") || msg.includes("ytdl:bg")) {
        globalThis.__cdnLogs.push(msg);
      }
      return origWarn.apply(console, arguments);
    };
    return "patched, existing logs: " + globalThis.__cdnLogs.length;
  })()
`);
console.log("Patch:", patchResult);

// Clean OPFS
const cleanup = await evalIn(sw.webSocketDebuggerUrl!, `
  (async function() {
    var root = await navigator.storage.getDirectory();
    try { await root.removeEntry("ycXjF91o73I-video-stream"); return "cleaned"; }
    catch(e) { return "skip: " + e.message; }
  })()
`);
console.log("OPFS cleanup:", cleanup);

// Click Download
const clickResult = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (function() {
    var btns = Array.from(document.querySelectorAll("button"));
    var retry = btns.find(function(b) { return b.textContent && b.textContent.trim() === "Retry download"; });
    if (retry) { retry.click(); return "retry"; }
    var dl = btns.find(function(b) { return b.textContent && b.textContent.trim() === "Download" && !b.disabled; });
    if (dl) { dl.click(); return "download"; }
    return "none: " + btns.map(function(b){ return b.textContent && b.textContent.trim(); }).filter(Boolean).join(",");
  })()
`);
console.log("Click:", clickResult);

// Wait 10s then collect
await new Promise(r => setTimeout(r, 10000));

const capturedLogs = await evalIn(sw.webSocketDebuggerUrl!, `
  (function() {
    return JSON.stringify(globalThis.__cdnLogs || []);
  })()
`);
console.log("Captured logs:", capturedLogs);
