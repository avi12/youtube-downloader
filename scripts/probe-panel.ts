import http from "http";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("C:/Users/Avi/AppData/Roaming/npm/node_modules/@google/gemini-cli/node_modules/ws/index.js");

const targets = await new Promise(resolve => {
  http.get("http://localhost:9229/json", res => {
    let d = ""; res.on("data", c => d += c);
    res.on("end", () => resolve(JSON.parse(d)));
  });
});

const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
const offscreen = targets.find(t => (t.url ?? "").includes("offscreen.html"));
const tab = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));

function attachMonitor(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  ws.on("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
  });
  ws.on("message", data => {
    const msg = JSON.parse(data);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
      console.log(`[${label}][${msg.params.type}] ${text}`);
    }

    if (msg.method === "Runtime.exceptionThrown") {
      console.log(`[${label}][EX] ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "?"}`);
    }
  });
  return ws;
}

const tabWs = attachMonitor(tab.webSocketDebuggerUrl, "TAB");
const swWs = attachMonitor(sw.webSocketDebuggerUrl, "SW");
const offWs = attachMonitor(offscreen.webSocketDebuggerUrl, "OFF");

await new Promise(r => setTimeout(r, 400));

tabWs.send(JSON.stringify({
  id: 10, method: "Runtime.evaluate", params: {
    expression: `
(async () => {
  const group = document.querySelector("[data-ytdl-download-group]");
  const buttons = group?.querySelectorAll("button");
  console.log("[probe] clicking chevron");
  buttons?.[1]?.click();
  await new Promise(r => setTimeout(r, 700));
  const panel = document.querySelector(".ytdl-panel");
  console.log("[probe] panel opened:", Boolean(panel));
  const closeInner = panel?.querySelector(".ytdl-panel-header yt-button-view-model button");
  console.log("[probe] closeInner found:", Boolean(closeInner));
  closeInner?.click();
  console.log("[probe] clicked inner close button");
  await new Promise(r => setTimeout(r, 700));
  console.log("[probe] panel still present:", Boolean(document.querySelector(".ytdl-panel")));
  return "done";
})()
    `,
    awaitPromise: true, returnByValue: true
  }
}));

await new Promise(r => setTimeout(r, 6000));
tabWs.close(); swWs.close(); offWs.close();
