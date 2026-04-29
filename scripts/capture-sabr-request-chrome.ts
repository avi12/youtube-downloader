import { findExtensionTargets } from "./cdp-utils.js";
import { writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const LISTEN_MS = 40_000;

const { serviceWorker, tab } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);
console.log("SW:", serviceWorker?.webSocketDebuggerUrl?.slice(0, 60));
console.log("Tab:", tab?.url?.slice(0, 60));

const swSocket = new WebSocket(serviceWorker!.webSocketDebuggerUrl!);
const tabSocket = new WebSocket(tab!.webSocketDebuggerUrl!);

let capturedRequestId: string | null = null;

swSocket.on("open", () => {
  swSocket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.enable"
    })
  );
  swSocket.send(
    JSON.stringify({
      id: 2,
      method: "Network.enable"
    })
  );
});

swSocket.on("message", rawData => {
  const msg = JSON.parse(String(rawData));
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params?.args ?? []).map((arg: Record<string, unknown>) =>
      arg["value"] ?? arg["description"] ?? JSON.stringify(arg)).join(" ");
    const level = msg.params?.type;
    if (level === "error" || level === "warning" || text.includes("ytdl")) {
      console.log(`[SW][${level}] ${text}`);
    }
  }

  if (msg.method === "Network.requestWillBeSent") {
    const req = msg.params?.request;
    if (req?.url?.includes("googlevideo.com/videoplayback") && req.method === "POST") {
      capturedRequestId = msg.params?.requestId;
      console.log("[NET] SABR POST to:", req.url.slice(0, 80));

      if (req.postData) {
        const b64 = Buffer.from(req.postData, "binary").toString("base64");
        writeFileSync("/tmp/our_sabr_request.b64", b64);
        console.log("[NET] Saved", req.postData.length, "bytes to /tmp/our_sabr_request.b64");
      } else {
        console.log("[NET] No postData captured (body may be empty or binary)");
      }
    }
  }

  if (msg.method === "Network.responseReceived" && msg.params?.requestId === capturedRequestId) {
    const resp = msg.params?.response;
    console.log("[NET] SABR response status:", resp?.status);
  }
});

tabSocket.on("open", () => {
  tabSocket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.enable"
    })
  );
});

await setTimeout(2000);

tabSocket.send(
  JSON.stringify({
    id: 10,
    method: "Runtime.evaluate",
    params: {
      expression: `(() => {
      const btn = document.querySelector("[data-ytdl-download-group] button");
      btn?.click();
      return btn?.getAttribute("aria-label");
    })()`,
      returnByValue: true
    }
  })
);

console.log("Download triggered, monitoring for", LISTEN_MS / 1000, "seconds...");
await setTimeout(LISTEN_MS);

swSocket.close();
tabSocket.close();
