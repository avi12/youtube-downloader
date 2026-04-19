import { once } from "node:events";
/**
 * CDP debug script - connects to service worker and offscreen document
 * Usage: node scripts/debug-cdp.mjs
 */
import http from "node:http";
import WebSocket from "ws";

const CDP_PORT = 9229;
const EVAL_TIMEOUT_MS = 8_000;

interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

async function listTargets(): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}/json`, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const parsed: CdpTarget[] = JSON.parse(data);
        resolve(parsed);
      });
      res.on("error", reject);
    });
  });
}

async function evalInTarget(wsUrl: string, expression: string, awaitPromise = false) {
  const signal = AbortSignal.timeout(EVAL_TIMEOUT_MS);
  const socket = new WebSocket(wsUrl);

  await once(socket, "open", { signal });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.enable"
    })
  );
  socket.send(
    JSON.stringify({
      id: 2,
      method: "Runtime.evaluate",
      params: {
        expression,
        returnByValue: true,
        awaitPromise
      }
    })
  );

  while (true) {
    const [rawData] = await once(socket, "message", { signal });
    const msg = JSON.parse(String(rawData));
    if (msg.id === 2) {
      socket.close();

      if (msg.result?.exceptionDetails) {
        throw new Error(msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text);
      }

      return msg.result?.result?.value;
    }
  }
}

// Main
const targets = await listTargets();
const serviceWorker = targets.find(target => target.type === "service_worker");
const offscreen = targets.find(target => target.url?.includes("offscreen"));
const ytPage = targets.find(target => target.url?.includes("youtube.com/watch"));

console.log("Service worker WS:", serviceWorker?.webSocketDebuggerUrl);
console.log("Offscreen WS:", offscreen?.webSocketDebuggerUrl);

// Check page state
if (ytPage) {
  const state = await evalInTarget(
    ytPage.webSocketDebuggerUrl!,
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
    })()`
  );
  console.log("\n=== YouTube page state ===");
  console.log(JSON.stringify(state, null, 2));
}

// Check service worker for captured SABR data
if (serviceWorker) {
  const swState = await evalInTarget(
    serviceWorker.webSocketDebuggerUrl!,
    `(() => {
      try {
        return { swAlive: true };
      } catch(e) { return { error: e.message }; }
    })()`
  );
  console.log("\n=== Service worker state ===");
  console.log(JSON.stringify(swState, null, 2));
}
