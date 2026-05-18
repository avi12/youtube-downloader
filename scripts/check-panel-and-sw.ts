import { findExtensionTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const ytPage = targets.find(t => t.type === "page" && t.url?.includes("youtube.com/watch") && t.url?.includes("ycXjF91o73I"));
const sw = targets.find(t => t.type === "service_worker" && t.url?.includes(CHROME_EXT_ID));

console.log("YT page:", ytPage ? ytPage.url : "not found");
console.log("SW:", sw ? "found" : "not found");

async function evalIn(wsUrl: string, expression: string, awaitPromise = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) {
        socket.close();
        if (msg.result?.exceptionDetails) {
          resolve("ERROR: " + JSON.stringify(msg.result.exceptionDetails));
        } else {
          resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? JSON.stringify(msg.result?.result));
        }
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

if (ytPage) {
  // Check the download panel state  
  const panelState = await evalIn(ytPage.webSocketDebuggerUrl!, `
    (() => {
      const panel = document.querySelector('#ytdl-download-panel, .ytdl-panel');
      if (!panel) return 'no panel found';
      const downloadBtn = panel.querySelector('[aria-label*="Download"], button[class*="download"]');
      const typeSelect = panel.querySelector('[id*="type"]');
      const progress = panel.querySelector('[class*="progress"], [class*="Progress"]');
      return JSON.stringify({
        panelExists: true,
        downloadBtnText: downloadBtn?.textContent?.trim() ?? 'not found',
        typeValue: typeSelect?.textContent?.trim() ?? 'not found',
        progressVisible: !!progress,
        progressText: progress?.textContent?.trim() ?? ''
      });
    })()
  `);
  console.log("Panel state:", panelState);
  
  // Check ytdl custom panel element
  const ytdlPanelState = await evalIn(ytPage.webSocketDebuggerUrl!, `
    (() => {
      // Look for the download button specifically
      const allBtns = document.querySelectorAll('button');
      const downloadBtns = [...allBtns].filter(b => b.textContent?.includes('Download') || b.textContent?.includes('download'));
      return downloadBtns.map(b => ({ text: b.textContent?.trim().slice(0, 50), disabled: b.disabled, className: b.className.slice(0, 50) })).slice(0, 5);
    })()
  `);
  console.log("Download buttons:", JSON.stringify(ytdlPanelState));
}

if (sw) {
  // Check recent SW errors
  const swOpfs = await evalIn(sw.webSocketDebuggerUrl!, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      const files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push(name + ':' + (file.size / 1024 / 1024).toFixed(1) + 'MB@' + new Date(file.lastModified).toISOString());
        }
      }
      return files.length ? files.join(', ') : 'empty';
    })()
  `, true);
  console.log("SW OPFS:", swOpfs);
  
  // Check recent downloads
  const downloads = await evalIn(sw.webSocketDebuggerUrl!, `
    (async () => {
      const items = await chrome.downloads.search({ limit: 5, orderBy: ['-startTime'] });
      return items.map(d => {
        const name = d.filename.split(/[\/]/).pop() ?? d.filename;
        return d.id + '|' + name.slice(0,60) + '|' + d.state + '|' + d.fileSize + '|' + d.mime;
      }).join('\n');
    })()
  `, true);
  console.log("Recent downloads:\n" + downloads);
}
