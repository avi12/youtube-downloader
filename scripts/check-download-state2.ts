import { findExtensionTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const { serviceWorker, offscreen } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

async function evalIn(wsUrl: string, expression: string): Promise<unknown> {
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
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

// Check OPFS from SW context
const swOpfs = await evalIn(serviceWorker!.webSocketDebuggerUrl!, `
  (async () => {
    const root = await navigator.storage.getDirectory();
    const files = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        files.push(name + ':' + (file.size / 1024 / 1024).toFixed(1) + 'MB');
      }
    }
    return files.length ? files.join(', ') : 'empty';
  })()
`);
console.log("SW OPFS:", swOpfs);

// Check OPFS from offscreen context
if (offscreen) {
  const offOpfs = await evalIn(offscreen.webSocketDebuggerUrl!, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      const files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push(name + ':' + (file.size / 1024 / 1024).toFixed(1) + 'MB');
        }
      }
      return files.length ? files.join(', ') : 'empty';
    })()
  `);
  console.log("Offscreen OPFS:", offOpfs);

  // Check accumulator state from offscreen
  const accState = await evalIn(offscreen.webSocketDebuggerUrl!, `
    (() => {
      if (typeof STREAM_ACCUMULATORS === 'undefined') return 'N/A';
      const result = {};
      for (const [key, acc] of STREAM_ACCUMULATORS.entries()) {
        result[key] = JSON.stringify({
          hasWriter: !!acc.opfsWriter,
          audioChunks: acc.audioChunks?.length ?? 0,
          videoChunks: acc.videoChunks?.length ?? 0,
          videoFinished: acc.videoFinished,
          audioFinished: acc.audioFinished
        });
      }
      return JSON.stringify(result);
    })()
  `);
  console.log("Accumulator state:", accState);
} else {
  console.log("No offscreen document found");
}

// Check active downloads in SW
const activeDownloads = await evalIn(serviceWorker!.webSocketDebuggerUrl!, `
  (() => {
    if (typeof activeBackgroundDownloads === 'undefined') return 'N/A (minified)';
    return JSON.stringify([...activeBackgroundDownloads.keys()]);
  })()
`);
console.log("Active downloads:", activeDownloads);
