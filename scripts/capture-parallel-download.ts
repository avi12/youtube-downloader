import http from "node:http";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const OFFSCREEN_PATH = "offscreen.html";
const LISTEN_DURATION_S = 60;

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

console.log("SW:", serviceWorker?.id, serviceWorker?.webSocketDebuggerUrl);
console.log("Offscreen:", offscreen?.id, offscreen?.url);

async function listenCDP(wsUrl: string, label: string, listenSeconds: number) {
  const logs: string[] = [];
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
    console.log(`[${label}] Listening for ${listenSeconds}s...`);
  });

  socket.on("message", (rawData: string) => {
    const msg = JSON.parse(rawData);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((arg: Record<string, unknown>) => arg.value ?? arg.description ?? JSON.stringify(arg)).join(" ");
      const entry = `[${label}:${msg.params.type}] ${text}`;
      console.log(entry);
      logs.push(entry);
    }

    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params.exceptionDetails;
      const entry = `[${label}:EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`;
      console.log(entry);
      logs.push(entry);
    }

    if (msg.method === "Log.entryAdded") {
      const entry = `[${label}:log:${msg.params.entry.level}] ${msg.params.entry.text}`;
      console.log(entry);
      logs.push(entry);
    }
  });

  await setTimeout(listenSeconds * 1000);
  socket.close();
  return logs;
}

console.log("\nListening for 60 seconds. Trigger the playlist download now!\n");

const [swLogs, offLogs] = await Promise.all([
  listenCDP(serviceWorker!.webSocketDebuggerUrl!, "SW", LISTEN_DURATION_S),
  listenCDP(offscreen!.webSocketDebuggerUrl!, "OFFSCREEN", LISTEN_DURATION_S)
]);

console.log("\n=== SUMMARY ===");
console.log(`SW: ${swLogs.length} entries, Offscreen: ${offLogs.length} entries`);
