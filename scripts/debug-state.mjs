import http from "http";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("C:/Users/Avi/AppData/Roaming/npm/node_modules/@google/gemini-cli/node_modules/ws/index.js");

const targets = await new Promise((resolve) => {
  http.get("http://localhost:9229/json", res => {
    let d = "";
    res.on("data", c => d += c);
    res.on("end", () => resolve(JSON.parse(d)));
  });
});

const offscreen = targets.find(t => (t.url ?? "").includes("offscreen.html"));
const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));

console.log("Offscreen ID:", offscreen?.id);
console.log("SW ID:", sw?.id);

function evalTarget(wsUrl, expr) {
  return new Promise(resolve => {
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression: expr, returnByValue: true, awaitPromise: true }
      }));
    });
    ws.on("message", data => {
      const msg = JSON.parse(data);
      if (msg.id === 1) {
        resolve(msg.result?.result);
        ws.close();
      }
    });
    setTimeout(() => { ws.close(); resolve({ timeout: true }); }, 8000);
  });
}

console.log("\n--- Offscreen state ---");
const offState = await evalTarget(offscreen.webSocketDebuggerUrl, `JSON.stringify({
  docReady: document.readyState,
  hasCreateFFmpeg: typeof createFFmpegCore !== "undefined",
  href: location.href
})`);
console.log(offState);

console.log("\n--- SW storage ---");
const swState = await evalTarget(sw.webSocketDebuggerUrl, `
(async () => {
  const q = await browser.storage.local.get(["local:videoQueue","local:statusProgress","local:musicList","local:videoDetails"]);
  return JSON.stringify(q, null, 2);
})()
`);
console.log(swState);

console.log("\n--- SW runtime probe ---");
const probe = await evalTarget(sw.webSocketDebuggerUrl, `
(async () => {
  const items = await chrome.storage.local.get();
  const dynRules = await chrome.declarativeNetRequest.getDynamicRules();
  return JSON.stringify({
    storageKeys: Object.keys(items),
    storage: items,
    dnrRules: dynRules.length
  }, null, 2);
})()
`);
console.log(probe);

console.log("\n--- Active downloads via chrome.downloads ---");
const dls = await evalTarget(sw.webSocketDebuggerUrl, `
(async () => {
  const all = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 3 });
  return JSON.stringify(all.map(d => ({
    id: d.id, filename: d.filename.slice(-40), state: d.state, exists: d.exists, mime: d.mime
  })), null, 2);
})()
`);
console.log(dls);
