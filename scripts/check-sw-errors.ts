import { fetchTargets, attachCdpMonitor } from "./cdp-utils.js";

const CDP_PORT = 9229;
const LISTEN_DURATION_MS = 5_000;

const targets = await fetchTargets(CDP_PORT);
const serviceWorker = targets.find(t => t.type === "service_worker");
const ytTab = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));

if (!serviceWorker?.webSocketDebuggerUrl) {
  console.log("No service worker found. Targets:", targets.map(t => `${t.type}: ${t.url?.slice(0, 80)}`));
  process.exit(1);
}

console.log("Listening to SW:", serviceWorker.webSocketDebuggerUrl);
console.log("YT tab:", ytTab?.url);

const swSocket = attachCdpMonitor(serviceWorker.webSocketDebuggerUrl, "SW", true);

if (ytTab?.webSocketDebuggerUrl) {
  const tabSocket = attachCdpMonitor(ytTab.webSocketDebuggerUrl, "TAB");
  setTimeout(() => tabSocket.close(), LISTEN_DURATION_MS);
}

setTimeout(() => {
  swSocket.close();
  console.log("Done.");
  process.exit(0);
}, LISTEN_DURATION_MS);
