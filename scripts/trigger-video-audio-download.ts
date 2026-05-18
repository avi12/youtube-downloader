import http from "http";
import WebSocket from "ws";
import { setTimeout as sleep } from "timers/promises";

const data: any[] = await new Promise((res) => {
  http.get("http://localhost:9229/json", (r) => {
    let d = "";
    r.on("data", (c) => (d += c));
    r.on("end", () => res(JSON.parse(d)));
  });
});

const tab = data.find((t) => t.type === "page" && t.url?.includes("CjYRBfKlgro"));
const sw = data.find((t) => t.type === "service_worker" && t.url?.includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
const offscreen = data.find((t) => t.url?.includes("offscreen.html"));

if (!tab) { console.error("Watch tab not found"); process.exit(1); }
if (!sw) { console.error("SW not found"); process.exit(1); }

function evalCDP(wsUrl: string, expr: string, awaitPromise = false): Promise<any> {
  return new Promise((res) => {
    const s = new WebSocket(wsUrl);
    s.on("open", () => s.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise, returnByValue: true } })));
    s.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) { s.close(); res(msg.result?.result?.value ?? msg.result?.result?.description ?? null); }
    });
    setTimeout(() => { s.close(); res("timeout"); }, 10000);
  });
}

// First clean up any orphaned OPFS files
if (offscreen) {
  const cleanup = await evalCDP(offscreen.webSocketDebuggerUrl, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      const files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push(name + ':' + (file.size/1e6).toFixed(1) + 'MB');
        }
      }
      return files.join(', ') || 'empty';
    })()
  `, true);
  console.log("OPFS before start:", cleanup);

  // Remove any orphaned video-stream files
  await evalCDP(offscreen.webSocketDebuggerUrl, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file' && name.includes('video-stream')) {
          await root.removeEntry(name);
          console.log('Removed orphan:', name);
        }
      }
      return 'cleaned';
    })()
  `, true);
}

// Reload page to reset crossWorldMessenger
console.log("Reloading page...");
await new Promise<void>((res) => {
  const s = new WebSocket(tab.webSocketDebuggerUrl);
  s.on("open", () => s.send(JSON.stringify({ id: 1, method: "Page.reload" })));
  s.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id === 1) { s.close(); res(); }
  });
});

await sleep(4000);
console.log("Page reloaded, waiting for panel to render...");
await sleep(2000);

// Click download button to open panel
console.log("Clicking download button...");
await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const btn = document.querySelector('.ytdl-download-button');
    if (!btn) return 'not found';
    btn.click();
    return 'clicked';
  })()
`);
await sleep(1500);

// Find and click "Video + Audio" in the type dropdown
console.log("Selecting Video + Audio type...");
const typeResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const items = Array.from(document.querySelectorAll('tp-yt-paper-item'));
    const videoAudio = items.find(el => el.textContent?.trim().replace(/\\s+/g, ' ') === 'Video + Audio');
    if (!videoAudio) {
      const all = items.map(i => JSON.stringify(i.textContent?.trim().replace(/\\s+/g, ' '))).join(', ');
      return 'not found, available: ' + all;
    }
    videoAudio.click();
    return 'clicked: ' + videoAudio.textContent?.trim();
  })()
`);
console.log("Type selection:", typeResult);
await sleep(1000);

// Select 1080p quality
console.log("Selecting 1080p quality...");
const qualResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const items = Array.from(document.querySelectorAll('tp-yt-paper-item'));
    const q = items.find(el => el.textContent?.trim().includes('1080') && el.textContent?.trim().includes('30'));
    if (!q) {
      const all = items.map(i => JSON.stringify(i.textContent?.trim().replace(/\\s+/g, ' '))).slice(0, 10).join(', ');
      return 'not found, available: ' + all;
    }
    q.click();
    return 'clicked: ' + q.textContent?.trim();
  })()
`);
console.log("Quality selection:", qualResult);
await sleep(800);

// Click Download button
console.log("Clicking Download...");
const dlResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const btns = Array.from(document.querySelectorAll('yt-button-view-model button, tp-yt-paper-button'));
    const dlBtn = btns.find(b => b.textContent?.trim() === 'Download');
    if (!dlBtn) {
      const all = btns.map(b => JSON.stringify(b.textContent?.trim())).join(', ');
      return 'not found, buttons: ' + all;
    }
    dlBtn.click();
    return 'clicked download';
  })()
`);
console.log("Download button:", dlResult);

// Now monitor SW + offscreen logs for the filename diagnostic
console.log("\n=== Monitoring logs (will run for 600s) ===");
const start = Date.now();

const swSock = new WebSocket(sw.webSocketDebuggerUrl);
swSock.on("open", () => swSock.send(JSON.stringify({ id: 1, method: "Runtime.enable" })));
swSock.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params?.args ?? []).map((a: any) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
    const t = ((Date.now() - start) / 1000).toFixed(0);
    console.log(`[${t}s][SW][${msg.params?.type}] ${text}`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const t = ((Date.now() - start) / 1000).toFixed(0);
    const d = msg.params?.exceptionDetails;
    console.log(`[${t}s][SW][EX] ${d?.exception?.description ?? d?.text ?? "?"}`);
  }
});

const offSock = offscreen ? new WebSocket(offscreen.webSocketDebuggerUrl) : null;
if (offSock) {
  offSock.on("open", () => offSock.send(JSON.stringify({ id: 1, method: "Runtime.enable" })));
  offSock.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params?.args ?? []).map((a: any) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
      const t = ((Date.now() - start) / 1000).toFixed(0);
      console.log(`[${t}s][OFF][${msg.params?.type}] ${text}`);
    }
  });
}

// Check OPFS every 30s
let done = false;
const checkInterval = setInterval(async () => {
  if (done || !offscreen) return;
  const checkSock = new WebSocket(offscreen.webSocketDebuggerUrl);
  checkSock.on("open", () => {
    checkSock.send(JSON.stringify({
      id: 1, method: "Runtime.evaluate", params: {
        expression: `(async () => {
          const root = await navigator.storage.getDirectory();
          const files = [];
          for await (const [name, handle] of root.entries()) {
            if (handle.kind === 'file') {
              const file = await handle.getFile();
              files.push(name + ':' + (file.size/1e6).toFixed(1) + 'MB');
            }
          }
          return files.join(', ') || 'empty';
        })()`,
        awaitPromise: true, returnByValue: true
      }
    }));
  });
  checkSock.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id === 1) {
      const t = ((Date.now() - start) / 1000).toFixed(0);
      console.log(`[${t}s][OPFS] ${msg.result?.result?.value ?? "err"}`);
      checkSock.close();
    }
  });
}, 30000);

await sleep(600000);
done = true;
clearInterval(checkInterval);
swSock.close();
offSock?.close();
console.log("Done.");
