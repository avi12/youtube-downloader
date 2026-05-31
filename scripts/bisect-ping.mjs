import WebSocket from "ws";

const port = Number(process.argv[2] ?? 9229);

async function cdp(wsUrl, method, params = {}, timeoutMs = 8000) {
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
    ws.onerror = err => { if (!done) { done = true; resolve({ error: String(err.message || err) }); } };
    setTimeout(() => { if (!done) { done = true; ws.close(); resolve({ error: "timeout" }); } }, timeoutMs);
  });
}

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const ytTab = targets.find(t => t.type === "page" && t.url.includes("youtube.com/watch"));
console.log("ytTab:", ytTab?.url, ytTab?.webSocketDebuggerUrl);

const r = await cdp(ytTab.webSocketDebuggerUrl, "Runtime.evaluate", {
  expression: "1+1",
  returnByValue: true
}, 5000);
console.log("ping result:", JSON.stringify(r, null, 2));
