import http from "node:http";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const OFFSCREEN_PATH = "offscreen.html";
const KICKOFF_DELAY_MS = 300;
const LISTEN_DURATION_S = 3;

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

  socket.on("message", (rawData: string) => {
    const msg = JSON.parse(rawData);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((arg: Record<string, unknown>) => arg.value ?? arg.description ?? JSON.stringify(arg)).join(" ");
      logs.push(`[${msg.params.type}] ${text}`);
    }

    if (msg.method === "Runtime.exceptionThrown") {
      const detail = msg.params.exceptionDetails;
      logs.push(`[EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`);
    }

    if (msg.method === "Log.entryAdded") {
      logs.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text}`);
    }

    if (msg.id === 3) {
      logs.push(`[eval result] ${JSON.stringify(msg.result)}`);
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

const swLogs = await runCDP(serviceWorker!.webSocketDebuggerUrl!, LISTEN_DURATION_S, kickoff);
console.log("\n--- SW logs ---");
swLogs.forEach(line => console.log(line));

const offLogs = await runCDP(offscreen!.webSocketDebuggerUrl!, LISTEN_DURATION_S, null);
console.log("\n--- Offscreen logs (passive, 3s) ---");
offLogs.forEach(line => console.log(line));
