import { once } from "node:events";
import http from "node:http";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const OFFSCREEN_PATH = "offscreen.html";
const EVAL_TIMEOUT_MS = 8_000;

interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

const targets = await new Promise<CdpTarget[]>(resolve => {
  http.get(`http://localhost:${CDP_PORT}/json`, res => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => {
      const parsed: CdpTarget[] = JSON.parse(data);
      resolve(parsed);
    });
  });
});

const offscreen = targets.find(target => (target.url ?? "").includes(OFFSCREEN_PATH));
const serviceWorker = targets.find(target => target.type === "service_worker" && (target.url ?? "").includes(CHROME_EXT_ID));

console.log("Offscreen ID:", offscreen?.id);
console.log("SW ID:", serviceWorker?.id);

async function evalTarget(wsUrl: string, expr: string) {
  const signal = AbortSignal.timeout(EVAL_TIMEOUT_MS);
  const socket = new WebSocket(wsUrl);

  await once(socket, "open", { signal });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      }
    })
  );

  const [rawData] = await once(socket, "message", { signal });
  socket.close();
  return JSON.parse(String(rawData)).result?.result;
}

console.log("\n--- Offscreen state ---");
const offState = await evalTarget(
  offscreen!.webSocketDebuggerUrl!, `JSON.stringify({
  docReady: document.readyState,
  hasCreateFFmpeg: typeof createFFmpegCore !== "undefined",
  href: location.href
})`
);
console.log(offState);

console.log("\n--- SW storage ---");
const swState = await evalTarget(
  serviceWorker!.webSocketDebuggerUrl!, `
(async () => {
  const q = await browser.storage.local.get(["local:videoQueue","local:statusProgress","local:musicList","local:videoDetails"]);
  return JSON.stringify(q, null, 2);
})()
`
);
console.log(swState);

console.log("\n--- SW runtime probe ---");
const probe = await evalTarget(
  serviceWorker!.webSocketDebuggerUrl!, `
(async () => {
  const items = await chrome.storage.local.get();
  const dynRules = await chrome.declarativeNetRequest.getDynamicRules();
  return JSON.stringify({
    storageKeys: Object.keys(items),
    storage: items,
    dnrRules: dynRules.length
  }, null, 2);
})()
`
);
console.log(probe);

console.log("\n--- Active downloads via chrome.downloads ---");
const dls = await evalTarget(
  serviceWorker!.webSocketDebuggerUrl!, `
(async () => {
  const all = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 3 });
  return JSON.stringify(all.map(d => ({
    id: d.id, filename: d.filename.slice(-40), state: d.state, exists: d.exists, mime: d.mime
  })), null, 2);
})()
`
);
console.log(dls);
