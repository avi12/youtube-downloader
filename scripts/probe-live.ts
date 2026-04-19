import http from "node:http";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const OFFSCREEN_PATH = "offscreen.html";
const LISTEN_DURATION_MS = 45_000;
const STARTUP_DELAY_MS = 500;

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

const serviceWorker = targets.find(target => target.type === "service_worker" && (target.url ?? "").includes(CHROME_EXT_ID));
const offscreen = targets.find(target => (target.url ?? "").includes(OFFSCREEN_PATH));
const tab = targets.find(target => target.type === "page" && (target.url ?? "").includes("youtube.com/watch"));

console.log("SW:", serviceWorker?.id?.slice(0, 12));
console.log("Offscreen:", offscreen?.id?.slice(0, 12));
console.log("Tab:", tab?.id?.slice(0, 12), tab?.url);

function attachMonitor(wsUrl: string, label: string) {
  const socket = new WebSocket(wsUrl);
  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.enable"
      })
    );
    socket.send(
      JSON.stringify({
        id: 2,
        method: "Log.enable"
      })
    );
  });
  socket.on("message", (rawData: string) => {
    const msg = JSON.parse(rawData);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((arg: Record<string, unknown>) => arg.value ?? arg.description ?? JSON.stringify(arg)).join(" ");
      console.log(`[${label}][${msg.params.type}] ${text}`);
    }

    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params.exceptionDetails;
      console.log(`[${label}][EX] ${detail?.exception?.description?.slice(0, 400) ?? detail?.text ?? "?"}`);
    }

    if (msg.method === "Log.entryAdded") {
      const entry = msg.params.entry;
      console.log(`[${label}][log:${entry.level}] ${entry.text?.slice(0, 400)}`);
    }
  });
  return socket;
}

const swSocket = attachMonitor(serviceWorker!.webSocketDebuggerUrl!, "SW");
const offSocket = attachMonitor(offscreen!.webSocketDebuggerUrl!, "OFF");
const tabSocket = attachMonitor(tab!.webSocketDebuggerUrl!, "TAB");

await setTimeout(STARTUP_DELAY_MS);

tabSocket.send(
  JSON.stringify({
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
  })
);

await setTimeout(LISTEN_DURATION_MS);

console.log("\n--- END 45s ---");
swSocket.close();
offSocket.close();
tabSocket.close();
