import { type CdpTarget, attachCdpMonitor, fetchTargets } from "./cdp-utils.js";
/**
 * Monitor console logs from service worker and offscreen document via CDP.
 * Chrome only - for Firefox use monitor-firefox.ts instead.
 * Usage: node scripts/monitor-cdp.mjs [durationSeconds]
 */
import { setTimeout } from "node:timers/promises";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const DEFAULT_DURATION_S = 20;
const durationMs = (parseInt(process.argv[2] ?? String(DEFAULT_DURATION_S), 10) || DEFAULT_DURATION_S) * 1000;

let targets: CdpTarget[];
try {
  targets = await fetchTargets(CDP_PORT);
} catch {
  console.error(`Cannot connect to CDP on port ${CDP_PORT}. Is the dev server running?`);
  process.exit(1);
}

const serviceWorker = targets.find(target => target.type === "service_worker" && target.url?.includes(CHROME_EXT_ID));
const offscreen = targets.find(target => target.url?.includes(`${CHROME_EXT_ID}/offscreen`));

console.log("SW:", serviceWorker?.webSocketDebuggerUrl ?? "not found");
console.log("Offscreen:", offscreen?.webSocketDebuggerUrl ?? "not found");
console.log(`Monitoring for ${durationMs / 1000}s...\n`);

if (!serviceWorker && !offscreen) {
  console.error(`No extension targets found on port ${CDP_PORT}. Is the dev server running?`);
  process.exit(1);
}

const sockets = [
  serviceWorker ? attachCdpMonitor(serviceWorker.webSocketDebuggerUrl!, "SW") : null,
  offscreen ? attachCdpMonitor(offscreen.webSocketDebuggerUrl!, "OFFSCREEN") : null
];

await setTimeout(durationMs);

for (const socket of sockets) {
  socket?.close();
}

console.log("Done.");
