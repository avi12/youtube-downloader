/**
 * Monitor console logs from service worker and offscreen document via CDP.
 * Usage: node scripts/monitor-cdp.mjs [durationSeconds]
 */
import http from "http";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const WebSocket = require("C:\\Users\\Avi\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\node_modules\\ws\\index.js");

const durationMs = (parseInt(process.argv[2] ?? "20") || 20) * 1000;

async function listTargets() {
  return new Promise((resolve, reject) => {
    http.get("http://localhost:9229/json", res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(JSON.parse(d)));
      res.on("error", reject);
    });
  });
}

function monitor(wsUrl, label) {
  return new Promise(resolve => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close(); resolve();
    }, durationMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    });

    ws.on("message", data => {
      const msg = JSON.parse(data);
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args
          .map(a => a.value ?? a.description ?? JSON.stringify(a))
          .join(" ");
        console.log(`[${label}][${msg.params.type}] ${text}`);
      }

      if (msg.method === "Runtime.exceptionThrown") {
        const detail = msg.params.exceptionDetails;
        console.error(`[${label}][EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`);
      }
    });

    ws.on("error", e => {
      clearTimeout(timer); console.error(`[${label}] WS error:`, e.message); resolve();
    });
  });
}

const targets = await listTargets();
const EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const sw = targets.find(t => t.type === "service_worker" && t.url?.includes(EXT_ID));
const offscreen = targets.find(t => t.url?.includes(`${EXT_ID}/offscreen`));

console.log("SW:", sw?.webSocketDebuggerUrl ?? "not found");
console.log("Offscreen:", offscreen?.webSocketDebuggerUrl ?? "not found");
console.log(`Monitoring for ${durationMs / 1000}s...`);

await Promise.all([
  sw ? monitor(sw.webSocketDebuggerUrl, "SW") : Promise.resolve(),
  offscreen ? monitor(offscreen.webSocketDebuggerUrl, "OFFSCREEN") : Promise.resolve()
]);

console.log("Done.");
