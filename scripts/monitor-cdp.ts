/**
 * Monitor console logs from service worker and offscreen document via CDP.
 * Chrome only - for Firefox use monitor-firefox.ts instead.
 * Usage: node scripts/monitor-cdp.mjs [durationSeconds]
 */
import http from "node:http";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const DEFAULT_DURATION_S = 20;
const durationMs = (parseInt(process.argv[2] ?? String(DEFAULT_DURATION_S)) || DEFAULT_DURATION_S) * 1000;

interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

async function listTargets(): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${CDP_PORT}/json`, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const parsed: CdpTarget[] = JSON.parse(data);
        resolve(parsed);
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function monitor(wsUrl: string, label: string) {
  const socket = new WebSocket(wsUrl);

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.enable"
      })
    );
  });

  socket.on("message", (rawData: string) => {
    const msg = JSON.parse(rawData);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args
        .map((arg: Record<string, unknown>) => arg.value ?? arg.description ?? JSON.stringify(arg))
        .join(" ");
      console.log(`[${label}][${msg.params.type}] ${text}`);
    }

    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params.exceptionDetails;
      console.error(`[${label}][EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`);
    }
  });

  socket.on("error", (error: Error) => {
    console.error(`[${label}] WS error:`, error.message);
  });

  await setTimeout(durationMs);
  socket.close();
}

let targets: CdpTarget[];
try {
  targets = await listTargets();
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

await Promise.all([
  serviceWorker ? monitor(serviceWorker.webSocketDebuggerUrl!, "SW") : Promise.resolve(),
  offscreen ? monitor(offscreen.webSocketDebuggerUrl!, "OFFSCREEN") : Promise.resolve()
]);

console.log("Done.");
