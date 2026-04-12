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
const tab = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));

console.log("SW:", sw?.id?.slice(0, 12));
console.log("Offscreen:", offscreen?.id?.slice(0, 12));
console.log("Tab:", tab?.id?.slice(0, 12), tab?.url);

function attachMonitor(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
  });
  ws.on("message", data => {
    const msg = JSON.parse(data);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
      console.log(`[${label}][${msg.params.type}] ${text}`);
    }

    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params.exceptionDetails;
      console.log(`[${label}][EX] ${detail?.exception?.description?.slice(0, 400) ?? detail?.text ?? "?"}`);
    }

    if (msg.method === "Log.entryAdded") {
      const e = msg.params.entry;
      console.log(`[${label}][log:${e.level}] ${e.text?.slice(0, 400)}`);
    }
  });
  return ws;
}

const swWs = attachMonitor(sw.webSocketDebuggerUrl, "SW");
const offWs = attachMonitor(offscreen.webSocketDebuggerUrl, "OFF");
const tabWs = attachMonitor(tab.webSocketDebuggerUrl, "TAB");

// Wait to let listeners wire up, then trigger the click from inside the tab
await new Promise(r => setTimeout(r, 500));

tabWs.send(JSON.stringify({
  id: 10,
  method: "Runtime.evaluate",
  params: {
    expression: `
      (() => {
        const btn = document.querySelector("[data-ytdl-download-group] button");
        btn?.click();
        return btn?.getAttribute("aria-label");
      })()
    `,
    returnByValue: true
  }
}));

await new Promise(r => setTimeout(r, 45000));

console.log("\n--- END 45s ---");
swWs.close();
offWs.close();
tabWs.close();
