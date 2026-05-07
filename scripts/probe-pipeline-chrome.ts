import { type CdpMessage, findExtensionTargets } from "./cdp-utils.js";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const KICKOFF_DELAY_MS = 300;
const LISTEN_DURATION_S = 3;

const { serviceWorker, offscreen } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

console.log("SW:", serviceWorker?.id);
console.log("Offscreen:", offscreen?.id);

async function runCDP(wsUrl: string, listenSeconds: number, kickoff: string | null) {
  const logs: string[] = [];
  const socket = new WebSocket(wsUrl);

  socket.on("open", async () => {
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

    if (kickoff) {
      await setTimeout(KICKOFF_DELAY_MS);
      socket.send(
        JSON.stringify({
          id: 3,
          method: "Runtime.evaluate",
          params: {
            expression: kickoff,
            awaitPromise: true,
            returnByValue: true
          }
        })
      );
    }
  });

  socket.on("message", rawData => {
    const message: CdpMessage = JSON.parse(String(rawData));
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params?.args ?? []).map(arg => arg.value ?? arg.description ?? JSON.stringify(arg)).join(" ");
      logs.push(`[${message.params?.type}] ${text}`);
    }

    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails;
      logs.push(`[EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`);
    }

    if (message.method === "Log.entryAdded") {
      logs.push(`[log:${message.params?.entry?.level}] ${message.params?.entry?.text}`);
    }

    if (message.id === 3) {
      logs.push(`[eval result] ${JSON.stringify(message.result)}`);
    }
  });

  await setTimeout(listenSeconds * 1000);
  socket.close();
  return logs;
}

// Call startBackgroundDownload directly from SW with a minimal payload
const kickoff = `
(async () => {
  try {
    const sabr = await chrome.storage.session?.get?.() ?? {};
    const dls = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 });
    const manifest = chrome.runtime.getManifest();
    return JSON.stringify({
      manifestVersion: manifest.manifest_version,
      lastDownload: dls[0] ? { id: dls[0].id, state: dls[0].state } : null,
      ok: true
    });
  } catch (e) {
    return "ERR: " + e.message;
  }
})()
`;

const serviceWorkerLogs = await runCDP(serviceWorker!.webSocketDebuggerUrl!, LISTEN_DURATION_S, kickoff);
console.log("\n--- SW logs ---");
serviceWorkerLogs.forEach(line => console.log(line));

const offscreenLogs = await runCDP(offscreen!.webSocketDebuggerUrl!, LISTEN_DURATION_S, null);
console.log("\n--- Offscreen logs (passive, 3s) ---");
offscreenLogs.forEach(line => console.log(line));
