import { findExtensionTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const { serviceWorker } = await findExtensionTargets(CDP_PORT, CHROME_EXT_ID);

async function evalInSW(expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(serviceWorker!.webSocketDebuggerUrl!);
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

// Check OPFS state
const opfsResult = await evalInSW(`
  (async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const files = [];
      for await (const [name, handle] of root.entries()) {
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          files.push(name + ':' + (file.size / 1024 / 1024).toFixed(1) + 'MB');
        }
      }
      return files.length ? files.join(', ') : 'empty';
    } catch(e) {
      return 'error: ' + e.message;
    }
  })()
`);
console.log("OPFS:", opfsResult);

// Check downloads
const downloadsResult = await evalInSW(`
  (async () => {
    const items = await chrome.downloads.search({ limit: 10, orderBy: ['-startTime'] });
    return items.map(d => d.id + '|' + d.filename.split(/[\/]/).pop() + '|' + d.state + '|' + d.fileSize + '|' + d.mime).join(' -- ');
  })()
`);
console.log("Downloads:", downloadsResult);
