import WebSocket from "ws";

const port = Number(process.argv[2] ?? 9229);

async function send(wsUrl, method, params = {}) {
  return new Promise(resolve => {
    const ws = new WebSocket(wsUrl);
    let done = false;
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = e => {
      const data = JSON.parse(String(e.data));
      if (data.id === 1) {
        done = true;
        ws.close();
        resolve(data);
      }
    };
    ws.onerror = () => { if (!done) resolve(null); };
    setTimeout(() => { if (!done) { ws.close(); resolve(null); } }, 4000);
  });
}

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const extId = "iakmamcpgldfjjbeamagdkelogmokjpj";

const extPage = targets.find(t => t.type === "page" && t.url.includes(`chrome://extensions/?id=${extId}`));
if (extPage) {
  await send(extPage.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: `new Promise(r => chrome.developerPrivate.reload("${extId}", { failQuietly: false, populateErrorForUnpacked: false }, () => r()))`,
    awaitPromise: true
  });
  console.log("extension fully reloaded via developerPrivate");
} else {
  const sw = targets.find(t => t.type === "service_worker" && t.url.startsWith("chrome-extension://"));
  if (sw) {
    await send(sw.webSocketDebuggerUrl, "Runtime.evaluate", { expression: "chrome.runtime.reload()" });
    console.log("fallback: SW reload signaled (manifest may stay stale)");
  }
}

const ytTabs = targets.filter(t => t.type === "page" && t.url.includes("youtube.com/watch"));
for (const tab of ytTabs) {
  await send(tab.webSocketDebuggerUrl, "Page.reload");
  console.log(`reloaded ${tab.url}`);
}
