import { attachCdpMonitor, findExtensionTargets } from "./cdp-utils.js";
import { setTimeout } from "node:timers/promises";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const LISTEN_DURATION_MS = 45_000;
const STARTUP_DELAY_MS = 500;

const { serviceWorker, offscreen, tab } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

console.log("SW:", serviceWorker?.id?.slice(0, 12));
console.log("Offscreen:", offscreen?.id?.slice(0, 12));
console.log("Tab:", tab?.id?.slice(0, 12), tab?.url);

const serviceWorkerSocket = attachCdpMonitor(serviceWorker!.webSocketDebuggerUrl!, "SW", true);
const offscreenSocket = attachCdpMonitor(offscreen!.webSocketDebuggerUrl!, "OFF", true);
const tabSocket = attachCdpMonitor(tab!.webSocketDebuggerUrl!, "TAB", true);

await setTimeout(STARTUP_DELAY_MS);

tabSocket.send(
  JSON.stringify({
    id: 10,
    method: "Runtime.evaluate",
    params: {
      expression: `
      (() => {
        const btn = document.querySelector("[data-ytdl-download-group] button");
        btn?.click();
        return btn?.getAttribute("aria-label");
      })()
    `,
      returnByValue: true
    }
  })
);

await setTimeout(LISTEN_DURATION_MS);

console.log("\n--- END 45s ---");
serviceWorkerSocket.close();
offscreenSocket.close();
tabSocket.close();
