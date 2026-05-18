import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const allTargets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

// Get fresh targets after possible rebuild
const ytPage = allTargets.find(t => t.type === "page" && t.url?.includes("ycXjF91o73I"));
const sw = allTargets.find(t => t.type === "service_worker" && t.url?.includes(CHROME_EXT_ID));

console.log("YT page:", ytPage ? "found" : "NOT FOUND");
console.log("SW:", sw ? "found" : "NOT FOUND");

if (!ytPage || !sw) process.exit(1);

async function evalIn(wsUrl: string, expression: string, awaitPromise = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) {
        socket.close();
        resolve(String(msg.result?.result?.value ?? msg.result?.result?.description ?? '?'));
      }
    });
    socket.on("error", e => { reject(e); });
    setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 15000);
  });
}

// Listen to SW console FIRST  
const swLogs: string[] = [];
const consoleSocket = new WebSocket(sw.webSocketDebuggerUrl!);
await new Promise<void>(resolve => {
  consoleSocket.on("open", () => {
    consoleSocket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    consoleSocket.send(JSON.stringify({ id: 2, method: "Console.enable" }));
    setTimeout(resolve, 800);
  });
  consoleSocket.on("error", () => resolve());
});

consoleSocket.on("message", (raw: Buffer) => {
  const msg = JSON.parse(String(raw));
  if (msg.method === "Console.messageAdded") {
    const text = String(msg.params.message.text ?? "");
    if (text.includes("ytdl:bg") || text.includes("CDN check")) {
      swLogs.push(text);
    }
  }
});

// Click download button
const clicked = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (function() {
    var btns = Array.from(document.querySelectorAll("button"));
    var retry = btns.find(function(b) { return b.textContent && b.textContent.trim() === "Retry download"; });
    if (retry) { retry.click(); return "clicked retry"; }
    var dl = btns.find(function(b) { return b.textContent && b.textContent.trim() === "Download" && !b.disabled; });
    if (dl) { dl.click(); return "clicked download"; }
    return "no button: " + btns.filter(function(b) { return b.textContent && b.textContent.trim().length > 0 && b.textContent.trim().length < 30; }).map(function(b) { return b.textContent.trim(); }).slice(0, 5).join(", ");
  })()
`);
console.log("Click result:", clicked);

// Wait 15s to capture SW logs (SABR fails quickly, CDN check logged immediately after)
await new Promise(r => setTimeout(r, 15000));

consoleSocket.close();
console.log("\nSW logs (" + swLogs.length + "):");
for (const log of swLogs) {
  console.log("  " + log);
}
