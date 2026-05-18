import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const sw = targets.find(t => t.type === "service_worker" && t.url?.includes(CHROME_EXT_ID));
const ytPage = targets.find(t => t.type === "page" && t.url?.includes("youtube.com/watch") && t.url?.includes("ycXjF91o73I"));

console.log("SW found:", !!sw);
console.log("YT page found:", !!ytPage);

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
          resolve("ERROR: " + msg.result.exceptionDetails.exception?.description);
        } else {
          resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? JSON.stringify(msg.result?.result));
        }
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

// Inject a listener in the SW to capture the next download request
if (sw) {
  const injected = await evalIn(sw.webSocketDebuggerUrl!, `
    (() => {
      // Store the last download request for inspection
      globalThis.__capturedRequests = globalThis.__capturedRequests || [];
      return 'ready; captured count: ' + globalThis.__capturedRequests.length;
    })()
  `);
  console.log("SW inject:", injected);
  
  // Check last captured request if any
  const captured = await evalIn(sw.webSocketDebuggerUrl!, `
    (() => {
      const reqs = globalThis.__capturedRequests || [];
      if (reqs.length === 0) return 'none captured yet';
      const last = reqs[reqs.length - 1];
      return JSON.stringify({
        videoId: last.videoId,
        type: last.type,
        hasResolvedVideoUrl: !!last.resolvedVideoUrl,
        resolvedVideoUrlPrefix: last.resolvedVideoUrl?.slice(0, 80),
        hasResolvedAudioUrl: !!last.resolvedAudioUrl,
        resolvedAudioUrlPrefix: last.resolvedAudioUrl?.slice(0, 80),
        hasSabrConfig: !!last.sabrConfig
      });
    })()
  `);
  console.log("Last request:", captured);
}

// Check the download request via the content script / page
// The page sends a message to SW when download is initiated
// We can intercept this by checking what the panel state is
if (ytPage) {
  const panelInfo = await evalIn(ytPage.webSocketDebuggerUrl!, `
    (() => {
      // Try to find ytdl state from the page
      const ytdlEl = document.querySelector('[data-ytdl-download-request]');
      if (ytdlEl) return ytdlEl.getAttribute('data-ytdl-download-request');
      
      // Look at window.__ytdl state
      if (typeof window.__ytdlState !== 'undefined') return JSON.stringify(window.__ytdlState);
      
      // Check for YTDL extension state
      const allElements = document.querySelectorAll('[class*="ytdl"]');
      return 'elements found: ' + allElements.length;
    })()
  `);
  console.log("Page ytdl state:", panelInfo);
  
  // Check what format quality options are available
  const formatInfo = await evalIn(ytPage.webSocketDebuggerUrl!, `
    (() => {
      // Try to find quality selector
      const qualitySelect = document.querySelector('[id*="quality"]');
      const typeSelect = document.querySelector('[id*="type"]');
      return JSON.stringify({
        qualityText: qualitySelect?.textContent?.trim(),
        typeText: typeSelect?.textContent?.trim()
      });
    })()
  `);
  console.log("Format info:", formatInfo);
}
