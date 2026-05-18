import { findExtensionTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const { serviceWorker, offscreen } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

async function evalInContext(wsUrl: string, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) {
        socket.close();
        resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? JSON.stringify(msg.result));
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 8000);
  });
}

const swResult = await evalInContext(serviceWorker!.webSocketDebuggerUrl!, `
  JSON.stringify({
    swSidePort: typeof swSidePort !== 'undefined' ? (swSidePort ? 'connected' : 'null') : 'undefined'
  })
`);
console.log("SW port state:", swResult);

const offResult = await evalInContext(offscreen!.webSocketDebuggerUrl!, `
  JSON.stringify({
    accumulatorKeys: typeof STREAM_ACCUMULATORS !== 'undefined' ? [...STREAM_ACCUMULATORS.keys()] : 'N/A'
  })
`);
console.log("Offscreen accumulators:", offResult);
