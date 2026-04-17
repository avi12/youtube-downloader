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

console.log("SW:", sw?.id, sw?.webSocketDebuggerUrl);
console.log("Offscreen:", offscreen?.id, offscreen?.url);

function listenCDP(wsUrl, label, listenSeconds) {
  return new Promise(resolve => {
    const logs = [];
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
      console.log(`[${label}] Listening for ${listenSeconds}s...`);
    });

    ws.on("message", data => {
      const msg = JSON.parse(data);
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
        const entry = `[${label}:${msg.params.type}] ${text}`;
        console.log(entry);
        logs.push(entry);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const detail = msg.params.exceptionDetails;
        const entry = `[${label}:EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`;
        console.log(entry);
        logs.push(entry);
      }
      if (msg.method === "Log.entryAdded") {
        const entry = `[${label}:log:${msg.params.entry.level}] ${msg.params.entry.text}`;
        console.log(entry);
        logs.push(entry);
      }
    });

    setTimeout(() => {
      ws.close();
      resolve(logs);
    }, listenSeconds * 1000);
  });
}

console.log("\nListening for 20 seconds. Trigger the 'All at once' download now!\n");

const [swLogs, offLogs] = await Promise.all([
  listenCDP(sw.webSocketDebuggerUrl, "SW", 20),
  listenCDP(offscreen.webSocketDebuggerUrl, "OFFSCREEN", 20)
]);

console.log("\n=== SUMMARY ===");
console.log(`SW: ${swLogs.length} entries, Offscreen: ${offLogs.length} entries`);
