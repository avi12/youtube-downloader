import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const ytPage = targets.find(t => t.type === "page" && t.url?.includes("youtube.com/watch") && t.url?.includes("ycXjF91o73I"));
const sw = targets.find(t => t.type === "service_worker" && t.url?.includes(CHROME_EXT_ID));

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

if (sw) {
  // Clean up the orphaned OPFS file
  const cleanup = await evalIn(sw.webSocketDebuggerUrl!, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      const toDelete = ['ycXjF91o73I-video-stream', 'ycXjF91o73I-mux-out'];
      const results = [];
      for (const name of toDelete) {
        try {
          await root.removeEntry(name);
          results.push('deleted: ' + name);
        } catch (e) {
          results.push('skip: ' + name + ' (' + e.message + ')');
        }
      }
      // Verify
      const files = [];
      for await (const [n] of root.entries()) {
        files.push(n);
      }
      results.push('remaining: ' + (files.length ? files.join(', ') : 'empty'));
      return results.join('; ');
    })()
  `, true);
  console.log("OPFS cleanup:", cleanup);
}

if (ytPage) {
  // Find and click the Retry download button
  const retryResult = await evalIn(ytPage.webSocketDebuggerUrl!, `
    (() => {
      const allBtns = document.querySelectorAll('button');
      const retryBtn = [...allBtns].find(b => b.textContent?.trim() === 'Retry download');
      if (!retryBtn) {
        // Try Download button
        const dlBtn = [...allBtns].find(b => b.textContent?.trim() === 'Download' && !b.disabled);
        if (dlBtn) {
          dlBtn.click();
          return 'clicked Download button';
        }
        return 'no retry or download button found; buttons: ' + [...allBtns].filter(b => b.textContent?.trim()).map(b => b.textContent?.trim()).slice(0, 10).join(', ');
      }
      retryBtn.click();
      return 'clicked retry';
    })()
  `);
  console.log("Button click:", retryResult);
}
