import http from "node:http";
import WebSocket from "ws";

function cdpGet(path) {
  return new Promise(resolve => {
    const request = http.get(`http://localhost:9229${path}`, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve(null);
        }
      });
    });
    request.on("error", () => resolve(null));
  });
}

async function cdpEval(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.on("open", r));
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  return new Promise(resolve => {
    ws.on("message", d => {
      const p = JSON.parse(d.toString());
      if (p.id === 1) {
        ws.close(); resolve(p.result?.result?.value || p.result?.exceptionDetails?.text || "no result");
      }
    });
    setTimeout(() => {
      ws.close(); resolve("timeout");
    }, 15000);
  });
}

async function main() {
  const targets = await cdpGet("/json/list");
  const sw = targets?.find(t => t.type === "service_worker" && t.url.includes("hmcmoecpiockpfaaeehagiidhkfgijdk"));
  if (!sw) {
    console.log("no SW"); return;
  }

  // Step 1: Unregister all, register minimal test
  console.log("Step 1: Registering minimal test content script...");
  const reg = await cdpEval(sw.webSocketDebuggerUrl, `(async()=>{
    const ex = await chrome.scripting.getRegisteredContentScripts();
    if (ex.length) await chrome.scripting.unregisterContentScripts({ids:ex.map(s=>s.id)});
    await chrome.scripting.registerContentScripts([{
      id: "test-inject",
      matches: ["https://www.youtube.com/*"],
      js: ["content-scripts/youtube.js"],
      runAt: "document_idle",
      persistAcrossSessions: true
    }]);
    const after = await chrome.scripting.getRegisteredContentScripts();
    return "Registered " + after.length + " scripts: " + after.map(s=>s.id).join(", ");
  })()`);
  console.log("  ", reg);

  // Step 2: Navigate tab
  console.log("Step 2: Navigating YouTube tab...");
  const nav = await cdpEval(sw.webSocketDebuggerUrl, `(async()=>{
    const tabs = await chrome.tabs.query({url:"https://www.youtube.com/*"});
    if (!tabs.length) return "no tabs";
    await chrome.tabs.update(tabs[0].id, {url: "https://www.youtube.com/feed/subscriptions"});
    return "navigated tab " + tabs[0].id;
  })()`);
  console.log("  ", nav);

  // Step 3: Wait and check
  console.log("Step 3: Waiting 15s for page load...");
  await new Promise(r => setTimeout(r, 15000));

  const targets2 = await cdpGet("/json/list");
  const pg = targets2?.find(t => t.type === "page" && t.url.includes("subscriptions"));
  if (!pg) {
    console.log("  No subscriptions page"); return;
  }

  const check = await cdpEval(pg.webSocketDebuggerUrl, `JSON.stringify({
    btns: document.querySelectorAll("[data-ytdl-button-id]").length,
    items: document.querySelectorAll("[data-ytdl-grid-item]").length,
    scripts: document.querySelectorAll("script[src*='chrome-extension']").length,
    wxtActive: typeof __wxt_content_script_invalidated !== "undefined"
  })`);
  console.log("  Page state:", check);

  // Step 4: Check if the script file itself has errors by injecting it manually
  console.log("Step 4: Manual executeScript test...");
  const manual = await cdpEval(sw.webSocketDebuggerUrl, `(async()=>{
    const tabs = await chrome.tabs.query({url:"https://www.youtube.com/*"});
    if (!tabs.length) return "no tabs";
    try {
      const r = await chrome.scripting.executeScript({target:{tabId:tabs[0].id}, files:["content-scripts/youtube.js"]});
      return "executeScript result: " + JSON.stringify(r[0]?.result);
    } catch(e) {
      return "executeScript error: " + e.message;
    }
  })()`);
  console.log("  ", manual);

  // Step 5: Check page again after manual inject
  await new Promise(r => setTimeout(r, 10000));
  const check2 = await cdpEval(pg.webSocketDebuggerUrl, `JSON.stringify({
    btns: document.querySelectorAll("[data-ytdl-button-id]").length,
    items: document.querySelectorAll("[data-ytdl-grid-item]").length
  })`);
  console.log("  After manual inject:", check2);
}

main().catch(e => console.error(e));
