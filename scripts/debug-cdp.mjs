/**
 * CDP debug script - connects to service worker and offscreen document
 * Usage: node scripts/debug-cdp.mjs
 */
import http from "http";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const WebSocket = require("C:\\Users\\Avi\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\node_modules\\ws\\index.js");

async function listTargets() {
  return new Promise((resolve, reject) => {
    http.get("http://localhost:9229/json", res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(JSON.parse(d)));
      res.on("error", reject);
    });
  });
}

async function evalInTarget(wsUrl, expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close(); reject(new Error("Timeout"));
    }, 8000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({
        id: 2,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise }
      }));
    });

    ws.on("message", data => {
      const msg = JSON.parse(data);
      if (msg.id === 2) {
        clearTimeout(timeout);
        ws.close();

        if (msg.result?.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text));
        } else {
          resolve(msg.result?.result?.value);
        }
      }
    });

    ws.on("error", e => {
      clearTimeout(timeout); reject(e);
    });
  });
}

// Main
const targets = await listTargets();
const sw = targets.find(t => t.type === "service_worker");
const offscreen = targets.find(t => t.url?.includes("offscreen"));
const ytPage = targets.find(t => t.url?.includes("youtube.com/watch"));

console.log("Service worker WS:", sw?.webSocketDebuggerUrl);
console.log("Offscreen WS:", offscreen?.webSocketDebuggerUrl);

// Check page state
if (ytPage) {
  const state = await evalInTarget(ytPage.webSocketDebuggerUrl,
    `(() => {
      const group = document.querySelector('[data-ytdl-download-group]');
      const video = document.querySelector('video');
      return {
        buttonInjected: !!group,
        videoId: new URLSearchParams(location.search).get('v'),
        videoBufferedRanges: video ? video.buffered.length : 0,
        videoDuration: Math.round(video?.duration ?? 0),
        videoCurrentTime: Math.round(video?.currentTime ?? 0)
      };
    })()`);
  console.log("\n=== YouTube page state ===");
  console.log(JSON.stringify(state, null, 2));
}

// Check service worker for captured SABR data
if (sw) {
  const swState = await evalInTarget(sw.webSocketDebuggerUrl,
    `(() => {
      // Check if capturedByTab has any data
      try {
        return { swAlive: true };
      } catch(e) { return { error: e.message }; }
    })()`);
  console.log("\n=== Service worker state ===");
  console.log(JSON.stringify(swState, null, 2));
}
