import { attachCdpMonitor, findExtensionTargets } from "./cdp-utils.js";
import { setTimeout } from "node:timers/promises";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const STARTUP_DELAY_MS = 400;
const LISTEN_DURATION_MS = 6_000;

const { serviceWorker, offscreen, tab } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

const tabSocket = attachCdpMonitor(tab!.webSocketDebuggerUrl!, "TAB");
const serviceWorkerSocket = attachCdpMonitor(serviceWorker!.webSocketDebuggerUrl!, "SW");
const offscreenSocket = attachCdpMonitor(offscreen!.webSocketDebuggerUrl!, "OFF");

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
serviceWorkerSocket.close();
offscreenSocket.close();
