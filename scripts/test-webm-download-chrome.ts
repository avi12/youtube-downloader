/**
 * Verifies WebM download by intercepting the downloadRequest CrossWorldMessage
 * before it reaches the MAIN-world handler, forcing Opus audio (itag 251) and
 * a .webm filename. Then clicks Download and checks chrome.downloads for a .webm file.
 */
import { fetchTargets } from "./cdp-utils.js";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const DOWNLOAD_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_EVENT = "@webext-core/messaging/custom-events";

const targets = await fetchTargets(CDP_PORT);
const tab = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));
// SW may be dormant; fall back to offscreen document which can also call chrome.downloads
const extContext = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes(CHROME_EXT_ID))
  ?? targets.find(t => (t.url ?? "").includes(CHROME_EXT_ID));

if (!tab) {
  console.error("No YouTube watch tab found. Open a video first.");
  process.exit(1);
}
if (!extContext) {
  console.error("No extension context found.");
  process.exit(1);
}

console.log("Tab:", tab.url);
console.log("ExtCtx:", extContext.type, extContext.url?.slice(0, 60));

async function evalWs(wsUrl: string, expression: string): Promise<unknown> {
  const socket = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    socket.once("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    });
    socket.once("message", rawData => {
      socket.close();
      const msg = JSON.parse(String(rawData));
      resolve(msg.result?.result?.value ?? msg.result);
    });
    socket.once("error", reject);
  });
}

const evalTab = (expr: string) => evalWs(tab.webSocketDebuggerUrl!, expr);
const evalExt = (expr: string) => evalWs(extContext!.webSocketDebuggerUrl!, expr);

// Step 1: Install window.dispatchEvent intercept in the MAIN world of the tab
console.log("\n[1] Installing download-request intercept...");
const interceptResult = await evalTab(`
(function() {
  if (window.__ytdlWebmIntercept) return 'already installed';
  const origDispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = function(event) {
    if (
      event instanceof CustomEvent &&
      event.type === "${REQUEST_EVENT}" &&
      event.detail?.namespace === "ytdl" &&
      event.detail?.message?.type === "downloadRequest"
    ) {
      const detail = JSON.parse(JSON.stringify(event.detail));
      detail.message.data.audioItag = 251;
      const filename = detail.message.data.filenameOutput || "video.mkv";
      detail.message.data.filenameOutput = filename.replace(/\\.[^.]+$/, ".webm");
      console.log("[ytdl-test] Intercepted downloadRequest → audioItag=251 filename=", detail.message.data.filenameOutput);
      const patchedEvent = new CustomEvent("${REQUEST_EVENT}", {
        detail: detail,
        bubbles: event.bubbles,
        cancelable: event.cancelable
      });
      return origDispatch(patchedEvent);
    }
    return origDispatch(event);
  };
  window.__ytdlWebmIntercept = true;
  return 'intercept installed';
})()
`);
console.log("Result:", interceptResult);

// Step 2: Open the download panel
console.log("\n[2] Opening download panel...");
await evalTab(`
(async () => {
  const group = document.querySelector("[data-ytdl-download-group]");
  const chevron = group?.querySelectorAll("button")?.[1];
  chevron?.click();
  return chevron ? "clicked chevron" : "chevron not found";
})()
`);
await setTimeout(900);

// Step 3: Click the Download button inside the panel
console.log("\n[3] Clicking Download button...");
const clickResult = await evalTab(`
(async () => {
  const panel = document.querySelector(".ytdl-panel");
  if (!panel) return "panel not found";
  const downloadBtn = Array.from(panel.querySelectorAll("button")).find(btn =>
    btn.textContent?.trim().toLowerCase().includes("download") && !btn.closest(".ytdl-panel-header")
  );
  if (!downloadBtn) {
    // List all buttons for debugging
    return "buttons: " + Array.from(panel.querySelectorAll("button")).map(b => b.textContent?.trim()).join(", ");
  }
  downloadBtn.click();
  return "clicked: " + downloadBtn.textContent?.trim();
})()
`);
console.log("Click result:", clickResult);

// Step 4: Poll chrome.downloads for a .webm file
console.log("\n[4] Polling chrome.downloads for .webm file (up to 2 min)...");
const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
let found = false;

while (Date.now() < deadline) {
  await setTimeout(POLL_INTERVAL_MS);
  const result = await evalExt(`
    (async () => {
      const dls = await chrome.downloads.search({ orderBy: ["-startTime"], limit: 5 });
      return JSON.stringify(dls.map(d => ({
        id: d.id,
        filename: d.filename.slice(-60),
        state: d.state,
        mime: d.mime,
        bytesReceived: d.bytesReceived,
        totalBytes: d.totalBytes
      })));
    })()
  `);
  const downloads: Array<{ id: number; filename: string; state: string; mime: string; bytesReceived: number; totalBytes: number }> = JSON.parse(String(result));
  const webm = downloads.find(d => d.filename.endsWith(".webm"));
  if (webm) {
    console.log("\nWebM download found:", webm);
    if (webm.state === "complete") {
      console.log("\n✓ WebM download completed successfully!");
      found = true;
      break;
    } else if (webm.state === "interrupted") {
      console.error("\n✗ Download interrupted:", webm);
      break;
    } else {
      const pct = webm.totalBytes > 0 ? Math.round(webm.bytesReceived / webm.totalBytes * 100) : "?";
      console.log(`  in_progress ${pct}% (${webm.bytesReceived} / ${webm.totalBytes} bytes)`);
    }
  } else {
    console.log("  No .webm yet, latest:", downloads[0]?.filename ?? "none");
  }
}

if (!found) {
  console.error("\n✗ Timed out waiting for .webm download.");
}
