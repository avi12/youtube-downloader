import http from "http";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("C:/Users/Avi/AppData/Roaming/npm/node_modules/@google/gemini-cli/node_modules/ws/index.js");

const targets = await new Promise(resolve => {
  http.get("http://localhost:9229/json", res => {
    let d = "";
    res.on("data", c => d += c);
    res.on("end", () => resolve(JSON.parse(d)));
  });
});

const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
const offscreen = targets.find(t => (t.url ?? "").includes("offscreen.html"));

console.log("SW:", sw?.id);
console.log("Offscreen:", offscreen?.id);

function runCDP(wsUrl, listenSeconds, kickoff) {
  return new Promise(resolve => {
    const logs = [];
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
      if (kickoff) {
        setTimeout(() => {
          ws.send(JSON.stringify({
            id: 3,
            method: "Runtime.evaluate",
            params: { expression: kickoff, awaitPromise: true, returnByValue: true }
          }));
        }, 300);
      }
    });

    ws.on("message", data => {
      const msg = JSON.parse(data);
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
        logs.push(`[${msg.params.type}] ${text}`);
      }

      if (msg.method === "Runtime.exceptionThrown") {
        const detail = msg.params.exceptionDetails;
        logs.push(`[EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`);
      }

      if (msg.method === "Log.entryAdded") {
        logs.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text}`);
      }

      if (msg.id === 3) {
        logs.push(`[eval result] ${JSON.stringify(msg.result)}`);
      }
    });

    setTimeout(() => {
      ws.close();
      resolve(logs);
    }, listenSeconds * 1000);
  });
}

// Call startBackgroundDownload directly from SW with a minimal payload
const kickoff = `
(async () => {
  try {
    const sabr = await chrome.storage.session?.get?.() ?? {};
    const dls = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    const manifest = chrome.runtime.getManifest();
    return JSON.stringify({
      manifestVersion: manifest.manifest_version,
      lastDownload: dls[0] ? { id: dls[0].id, state: dls[0].state } : null,
      ok: true
    });
  } catch (e) {
    return "ERR: " + e.message;
  }
})()
`;

const swLogs = await runCDP(sw.webSocketDebuggerUrl, 3, kickoff);
console.log("\n--- SW logs ---");
swLogs.forEach(l => console.log(l));

const offLogs = await runCDP(offscreen.webSocketDebuggerUrl, 3, null);
console.log("\n--- Offscreen logs (passive, 3s) ---");
offLogs.forEach(l => console.log(l));
