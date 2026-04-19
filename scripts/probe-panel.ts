import http from "node:http";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const OFFSCREEN_PATH = "offscreen.html";
const STARTUP_DELAY_MS = 400;
const LISTEN_DURATION_MS = 6_000;

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

function attachMonitor(wsUrl: string, label: string) {
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
      const text = msg.params.args.map((arg: Record<string, unknown>) => arg.value ?? arg.description ?? JSON.stringify(arg)).join(" ");
      console.log(`[${label}][${msg.params.type}] ${text}`);
    }

    if (msg.method === "Runtime.exceptionThrown") {
      console.log(`[${label}][EX] ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "?"}`);
    }
  });
  return socket;
}

const tabSocket = attachMonitor(tab!.webSocketDebuggerUrl!, "TAB");
const swSocket = attachMonitor(serviceWorker!.webSocketDebuggerUrl!, "SW");
const offSocket = attachMonitor(offscreen!.webSocketDebuggerUrl!, "OFF");

await setTimeout(STARTUP_DELAY_MS);

tabSocket.send(
  JSON.stringify({
    id: 10,
    method: "Runtime.evaluate",
    params: {
      expression: `
(async () => {
  const group = document.querySelector("[data-ytdl-download-group]");
  const buttons = group?.querySelectorAll("button");
  console.log("[probe] clicking chevron");
  buttons?.[1]?.click();
  await new Promise(r => setTimeout(r, 700));
  const panel = document.querySelector(".ytdl-panel");
  console.log("[probe] panel opened:", Boolean(panel));
  const closeInner = panel?.querySelector(".ytdl-panel-header yt-button-view-model button");
  console.log("[probe] closeInner found:", Boolean(closeInner));
  closeInner?.click();
  console.log("[probe] clicked inner close button");
  await new Promise(r => setTimeout(r, 700));
  console.log("[probe] panel still present:", Boolean(document.querySelector(".ytdl-panel")));
  return "done";
})()
    `,
      awaitPromise: true,
      returnByValue: true
    }
  })
);

await setTimeout(LISTEN_DURATION_MS);
tabSocket.close();
swSocket.close();
offSocket.close();
