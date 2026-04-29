/**
 * Tests if the FFmpeg WASM URL is fetchable from the offscreen context.
 */
import { fetchTargets } from "./cdp-utils.js";
import { once } from "node:events";
import WebSocket from "ws";

const CDP_PORT = 9229;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const EVAL_TIMEOUT_MS = 15_000;

async function cdpEval(wsUrl: string, expr: string): Promise<string> {
  const signal = AbortSignal.timeout(EVAL_TIMEOUT_MS);
  const ws = new WebSocket(wsUrl);
  await once(ws, "open", { signal });
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      }
    })
  );
  const [raw] = await once(ws, "message", { signal });
  ws.close();
  const msg = JSON.parse(String(raw));
  if (msg.result?.exceptionDetails) {
    return "EX: " + (msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text);
  }

  const val = msg.result?.result?.value;
  return typeof val === "string" ? val : JSON.stringify(val);
}

const targets = await fetchTargets(CDP_PORT);
const offscreen = targets.find(target => target.url?.includes("offscreen"));
if (!offscreen?.webSocketDebuggerUrl) {
  console.error(
    "No offscreen target found. Targets:", targets.map(target => ({
      type: target.type,
      url: target.url
    }))
  );
  process.exit(1);
}

console.log("Offscreen URL:", offscreen.url);

// Check if FFmpeg is initialized
const state = await cdpEval(
  offscreen.webSocketDebuggerUrl, `
  JSON.stringify({
    href: location.href,
    hasCreateFFmpeg: typeof createFFmpegCore !== "undefined",
    doc: document.readyState,
    scripts: [...document.querySelectorAll('script')].map(s => s.src || '(inline)')
  })
`
);
console.log("Offscreen state:", state);

// Try fetching the WASM URL
const wasmTest = await cdpEval(
  offscreen.webSocketDebuggerUrl, `
  (async () => {
    try {
      const url = chrome.runtime.getURL('/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
      console.log('Testing URL:', url);
      const r = await fetch(url, {credentials: 'same-origin'});
      return JSON.stringify({ status: r.status, ok: r.ok, size: r.headers.get('content-length') });
    } catch (error) {
      return 'FETCH ERROR: ' + error.message + ' | URL: ' + chrome.runtime.getURL('/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
    }
  })()
`
);
console.log("WASM fetch test:", wasmTest);

// Check the locateFile callback output
const locateTest = await cdpEval(
  offscreen.webSocketDebuggerUrl, `
  (() => {
    const url = chrome.runtime.getURL('/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm');
    return url;
  })()
`
);
console.log("Expected WASM URL:", locateTest);
