import { attachCdpMonitor, findExtensionTargets, fetchTargets } from "./cdp-utils.js";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const MONITOR_SECONDS = 300; // 5 minutes

const targets = await fetchTargets(CDP_PORT);
const { serviceWorker, offscreen } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);
const tab = targets.find(t => t.type === "page" && t.url?.includes("youtube.com/watch?v=CjYRBfKlgro"));

console.log("SW:", serviceWorker?.id);
console.log("Offscreen:", offscreen?.id);
console.log("Tab:", tab?.id, tab?.url?.slice(0, 80));

if (!serviceWorker || !tab) {
  console.error("Missing targets - ensure dev Chrome is open on CjYRBfKlgro");
  process.exit(1);
}

// Attach monitors
const swSocket = attachCdpMonitor(serviceWorker.webSocketDebuggerUrl!, "SW", true);
if (offscreen) {
  attachCdpMonitor(offscreen.webSocketDebuggerUrl!, "OFFSCREEN", false);
}

// Trigger the download in the tab
const tabSocket = new WebSocket(tab.webSocketDebuggerUrl!);

tabSocket.on("open", async () => {
  tabSocket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
  await setTimeout(500);

  // Click download button to open panel
  const openPanelJs = `
    (() => {
      const btn = document.querySelector('.ytdl-download-button');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()
  `;

  tabSocket.send(JSON.stringify({
    id: 10,
    method: "Runtime.evaluate",
    params: { expression: openPanelJs, awaitPromise: false, returnByValue: true }
  }));
});

tabSocket.on("message", async rawData => {
  const msg = JSON.parse(String(rawData));

  if (msg.id === 10) {
    console.log("[TAB] open panel:", JSON.stringify(msg.result));
    await setTimeout(1200);

    // Select Video+Audio type then 1080p quality
    const selectQualityJs = `
      (async () => {
        // Find Video+Audio type button
        const typeItems = Array.from(document.querySelectorAll('tp-yt-paper-item'));
        const videoAudioItem = typeItems.find(el => el.textContent?.trim() === 'Video+Audio');
        if (videoAudioItem) {
          videoAudioItem.click();
          await new Promise(r => setTimeout(r, 600));
        }

        // Find and click 1080p quality
        const qualityItems = Array.from(document.querySelectorAll('tp-yt-paper-item'));
        const item1080 = qualityItems.find(el => el.textContent?.trim() === '1080p 30fps')
          ?? qualityItems.find(el => el.textContent?.includes('1080p'));
        if (item1080) {
          item1080.click();
          await new Promise(r => setTimeout(r, 400));
        }

        // Click primary download button
        const primaryBtn = document.querySelector('[data-ytdl-button-id="ytdl-panel-primary"]');
        if (primaryBtn) {
          primaryBtn.click();
          return 'download-started';
        }
        return 'no-primary-btn';
      })()
    `;

    tabSocket.send(JSON.stringify({
      id: 11,
      method: "Runtime.evaluate",
      params: { expression: selectQualityJs, awaitPromise: true, returnByValue: true }
    }));
  }

  if (msg.id === 11) {
    console.log("[TAB] start result:", JSON.stringify(msg.result));
    console.log(`\nMonitoring SW+Offscreen for ${MONITOR_SECONDS}s. Watch for [ytdl:stall] messages...\n`);
    tabSocket.close();
  }
});

// Periodic progress check against offscreen OPFS
let checkCount = 0;
const checkInterval = setInterval(async () => {
  checkCount++;
  if (!offscreen) return;

  const checkSocket = new WebSocket(offscreen.webSocketDebuggerUrl!);
  checkSocket.on("open", () => {
    checkSocket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `
          (async () => {
            const root = await navigator.storage.getDirectory();
            const files = [];
            for await (const [name, handle] of root.entries()) {
              if (handle.kind === 'file') {
                const file = await handle.getFile();
                files.push({ name, size: file.size });
              }
            }
            return JSON.stringify(files);
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      }
    }));
  });
  checkSocket.on("message", raw => {
    const msg = JSON.parse(String(raw));
    if (msg.id === 1) {
      const files = msg.result?.result?.value;
      if (files) {
        const parsed = JSON.parse(files);
        if (parsed.length > 0) {
          console.log(`[+${checkCount * 30}s][OPFS]`, parsed.map((f: {name: string, size: number}) => `${f.name}: ${(f.size / 1e6).toFixed(1)}MB`).join(", "));
        }
      }
      checkSocket.close();
    }
  });
}, 30_000);

await setTimeout(MONITOR_SECONDS * 1000);
clearInterval(checkInterval);
swSocket.close();
console.log("\nDone monitoring.");
