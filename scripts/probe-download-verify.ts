import { fetchTargets, attachCdpMonitor } from "./cdp-utils.js";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const MONITOR_SECONDS = 60;

const targets = await fetchTargets(CDP_PORT);
const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes(EXT_ID));
const offscreen = targets.find(t => (t.url ?? "").includes("offscreen.html"));
const watchTab = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));

console.log("SW:", sw?.id);
console.log("Offscreen:", offscreen?.id);
console.log("Watch tab:", watchTab?.url?.substring(0, 80));

if (!sw || !offscreen || !watchTab) {
  console.error("Missing targets");
  process.exit(1);
}

const swSocket = attachCdpMonitor(sw.webSocketDebuggerUrl!, "SW");
const offSocket = attachCdpMonitor(offscreen.webSocketDebuggerUrl!, "Offscreen");

// Attach to the watch tab to monitor console
const tabSocket = new WebSocket(watchTab.webSocketDebuggerUrl!);
tabSocket.on("open", () => {
  tabSocket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
  tabSocket.send(JSON.stringify({ id: 2, method: "Log.enable" }));
});
tabSocket.on("message", rawData => {
  const msg = JSON.parse(String(rawData));
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params?.args ?? []).map((a: Record<string, unknown>) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
    if ((text as string).includes("ytdl")) {
      console.log(`[Tab][${msg.params?.type}] ${text}`);
    }
  }
  if (msg.method === "Runtime.exceptionThrown") {
    console.log(`[Tab][EX] ${msg.params?.exceptionDetails?.exception?.description ?? "?"}`);
  }
});

console.log(`\nMonitoring for ${MONITOR_SECONDS}s — start a download in the browser now...`);
await wait(MONITOR_SECONDS * 1000);

swSocket.close();
offSocket.close();
tabSocket.close();
console.log("Done.");
