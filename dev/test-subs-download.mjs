import http from "http";
import WebSocket from "ws";

const PORT = process.argv[2] || 9227;
const ACTION = process.argv[3] || "check"; // check, navigate, click, monitor

function cdpRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${path}`, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

function cdpEval(wsUrl, expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise } }));
    });
    ws.on("message", raw => {
      const m = JSON.parse(raw.toString());
      if (m.id === 1) { resolve(m.result?.result?.value || JSON.stringify(m.result)); ws.close(); }
    });
    ws.on("error", reject);
    setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 10000);
  });
}

const pages = await cdpRequest("/json/list");
const ytPages = pages.filter(p => p.url.includes("youtube.com") && p.type === "page");
console.log("YouTube pages:", ytPages.map(p => p.url.substring(0, 60)).join(", "));

if (ACTION === "navigate") {
  // Navigate a YouTube page to subscriptions
  const page = ytPages[0];
  if (!page) { console.log("No YouTube page"); process.exit(1); }
  console.log("Navigating", page.url.substring(0, 40), "to subscriptions...");
  const result = await cdpEval(page.webSocketDebuggerUrl,
    'location.href = "https://www.youtube.com/feed/subscriptions"; "ok"');
  console.log("Result:", result);
}

if (ACTION === "check") {
  for (const page of ytPages) {
    const result = await cdpEval(page.webSocketDebuggerUrl, `
      JSON.stringify({
        url: location.href.substring(0, 50),
        gridItems: document.querySelectorAll('[data-ytdl-grid-item]').length,
        buttons: document.querySelectorAll('[data-ytdl-grid-item] yt-button-view-model button').length,
        firstId: document.querySelector('[data-ytdl-grid-item]')?.dataset?.ytdlGridItem,
        firstLabel: document.querySelector('[data-ytdl-grid-item] yt-button-view-model button')?.getAttribute('aria-label')?.substring(0,60)
      })
    `);
    console.log(result);
  }
}

if (ACTION === "click") {
  const videoId = process.argv[4] || "SbrLYkh8Ppw";
  const subsPage = ytPages.find(p => p.url.includes("subscriptions"));
  if (!subsPage) { console.log("No subscriptions page"); process.exit(1); }

  const result = await cdpEval(subsPage.webSocketDebuggerUrl, `
    (() => {
      const item = document.querySelector('[data-ytdl-grid-item="${videoId}"]');
      const btn = item?.querySelector('yt-button-view-model button');
      btn?.click();
      return 'clicked: ' + btn?.getAttribute('aria-label')?.substring(0, 50);
    })()
  `);
  console.log(result);
}

if (ACTION === "monitor") {
  const videoId = process.argv[4] || "SbrLYkh8Ppw";
  const subsPage = ytPages.find(p => p.url.includes("subscriptions"));
  if (!subsPage) { console.log("No subscriptions page"); process.exit(1); }

  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const result = await cdpEval(subsPage.webSocketDebuggerUrl, `
        (() => {
          const item = document.querySelector('[data-ytdl-grid-item="${videoId}"]');
          const btn = item?.querySelector('yt-button-view-model button');
          const p = item?.querySelector('tp-yt-paper-progress');
          return JSON.stringify({
            label: btn?.getAttribute('aria-label')?.substring(0, 60),
            progress: p?.getAttribute('value')
          });
        })()
      `);
      console.log("T+" + ((i + 1) * 5) + "s:", result);
    } catch {
      console.log("T+" + ((i + 1) * 5) + "s: connection lost");
      break;
    }
  }
}

process.exit();
