import http from "http";
import WebSocket from "ws";

const PORT = process.argv[2] || 9227;

const pages = await new Promise((resolve, reject) => {
  http.get(`http://localhost:${PORT}/json/list`, res => {
    let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d)));
  }).on("error", reject);
});

const subPages = pages.filter(p => p.url.includes("subscriptions") && p.type === "page");
console.log("Subs pages:", subPages.length);

for (const page of subPages) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const result = await new Promise(resolve => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `JSON.stringify({
            gridItems: document.querySelectorAll('[data-ytdl-grid-item]').length,
            buttons: document.querySelectorAll('[data-ytdl-grid-item] yt-button-view-model button').length
          })`
        }
      }));
    });
    ws.on("message", raw => {
      const m = JSON.parse(raw.toString());
      if (m.id === 1) {
        resolve(m.result?.result?.value); ws.close();
      }
    });
    setTimeout(() => {
      ws.close(); resolve("timeout");
    }, 5000);
  });
  console.log(`Page ${page.id.substring(0, 12)}:`, result);
}

process.exit();
