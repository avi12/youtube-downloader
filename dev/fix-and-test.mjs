import http from "http";
import WebSocket from "ws";

const PORT = process.argv[2] || "9227";

function cdpRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${path}`, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

function cdpEval(wsUrl, expression, contextId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      const params = { expression, awaitPromise: true };
      if (contextId) params.contextId = contextId;
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params }));
    });
    ws.on("message", raw => {
      const m = JSON.parse(raw.toString());
      if (m.id === 1) {
        resolve(m.result?.result?.value || m.result?.exceptionDetails?.text);
        ws.close();
      }
    });
    ws.on("error", reject);
    setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 15000);
  });
}

const pages = await cdpRequest("/json/list");

// Step 1: Unregister stale content scripts
const sw = pages.find(p => p.type === "service_worker" && p.url.includes("background"));
if (!sw) { console.log("No extension SW"); process.exit(1); }

console.log("Step 1: Unregistering stale content scripts...");
const unregResult = await cdpEval(sw.webSocketDebuggerUrl, `
  (async () => {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const staleIds = scripts.filter(s => !s.id.includes("youtube")).map(s => s.id);
    if (staleIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: staleIds });
    }
    const remaining = await chrome.scripting.getRegisteredContentScripts();
    return JSON.stringify({ removed: staleIds, remaining: remaining.map(s => s.id) });
  })()
`);
console.log(unregResult);

// Step 2: Reload the subscriptions page
const subsPage = pages.find(p => p.url.includes("subscriptions") && p.type === "page");
if (!subsPage) {
  // Navigate any YouTube page to subscriptions
  const ytPage = pages.find(p => p.url.includes("youtube") && p.type === "page");
  if (ytPage) {
    console.log("Step 2: Navigating to subscriptions...");
    await cdpEval(ytPage.webSocketDebuggerUrl, 'location.href = "https://www.youtube.com/feed/subscriptions"; "ok"');
  }
} else {
  console.log("Step 2: Reloading subscriptions page...");
  await cdpEval(subsPage.webSocketDebuggerUrl, 'location.reload(); "reloading"');
}

// Step 3: Wait for grid items
console.log("Step 3: Waiting for grid items...");
await new Promise(r => setTimeout(r, 12000));

const pages2 = await cdpRequest("/json/list");
const subs = pages2.find(p => p.url.includes("subscriptions") && p.type === "page");
if (!subs) { console.log("No subscriptions page"); process.exit(1); }

const gridCheck = await cdpEval(subs.webSocketDebuggerUrl, `
  (() => {
    const gi = document.querySelectorAll('[data-ytdl-grid-item]');
    const btns = document.querySelectorAll('[data-ytdl-grid-item] yt-button-view-model button');
    return JSON.stringify({ gridItems: gi.length, buttons: btns.length });
  })()
`);
console.log("Grid:", gridCheck);

// Step 4: Check registered scripts again
const sw2 = pages2.find(p => p.type === "service_worker" && p.url.includes("background"));
const scripts = await cdpEval(sw2.webSocketDebuggerUrl, `
  (async () => {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return JSON.stringify(scripts.map(s => s.id));
  })()
`);
console.log("Registered scripts:", scripts);

process.exit();
