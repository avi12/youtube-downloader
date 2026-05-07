import { type CdpMessage, findExtensionTargets } from "./cdp-utils.js";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const LISTEN_DURATION_S = 60;

const { serviceWorker, offscreen } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

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

  socket.on("message", rawData => {
    const message: CdpMessage = JSON.parse(String(rawData));
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params?.args ?? []).map(arg => arg.value ?? arg.description ?? JSON.stringify(arg)).join(" ");
      const entry = `[${label}:${message.params?.type}] ${text}`;
      console.log(entry);
      logs.push(entry);
    }

    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails;
      const entry = `[${label}:EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`;
      console.log(entry);
      logs.push(entry);
    }

    if (message.method === "Log.entryAdded") {
      const entry = `[${label}:log:${message.params?.entry?.level}] ${message.params?.entry?.text}`;
      console.log(entry);
      logs.push(entry);
    }
  });

  await setTimeout(listenSeconds * 1000);
  socket.close();
  return logs;
}

console.log("\nListening for 60 seconds. Trigger the playlist download now!\n");

const [serviceWorkerLogs, offscreenLogs] = await Promise.all([
  listenCDP(serviceWorker!.webSocketDebuggerUrl!, "SW", LISTEN_DURATION_S),
  listenCDP(offscreen!.webSocketDebuggerUrl!, "OFFSCREEN", LISTEN_DURATION_S)
]);

console.log("\n=== SUMMARY ===");
console.log(`SW: ${serviceWorkerLogs.length} entries, Offscreen: ${offscreenLogs.length} entries`);
