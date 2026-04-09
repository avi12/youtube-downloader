import http from "node:http";
import WebSocket from "ws";

function cdpGet(path) {
  return new Promise(resolve => {
    http.get(`http://localhost:9229${path}`, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve(null);
        }
      });
    }).on("error", () => resolve(null));
  });
}

async function cdpEvalSW(expression) {
  const targets = await cdpGet("/json/list");
  const sw = targets?.find(t => t.type === "service_worker" && t.url.includes("hmcmoecpiockpfaaeehagiidhkfgijdk"));
  if (!sw) {
    throw new Error("No SW");
  }

  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise(r => ws.on("open", r));
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  return new Promise(r => {
    ws.on("message", d => {
      const p = JSON.parse(d.toString());
      if (p.id === 1) {
        ws.close(); r(p.result?.result?.value);
      }
    });
  });
}

async function cdpEvalPage(expression) {
  const targets = await cdpGet("/json/list");
  const pg = targets?.find(t => t.type === "page" && t.url.includes("youtube"));
  if (!pg) {
    throw new Error("No page");
  }

  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.on("open", r));
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  return new Promise(r => {
    ws.on("message", d => {
      const p = JSON.parse(d.toString());
      if (p.id === 1) {
        ws.close(); r(p.result?.result?.value);
      }
    });
  });
}

async function main() {
  // Step 1: Get cookies from page
  const cookies = await cdpEvalPage("document.cookie");
  console.log("Page cookies:", cookies.length, "chars");
  console.log("Sample:", cookies.substring(0, 80));

  // Step 2: Update DNR rule with real cookies
  const updateResult = await cdpEvalSW(`(async () => {
    const cookies = ${JSON.stringify(cookies)};
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Origin", operation: "set", value: "https://www.youtube.com" },
            { header: "Cookie", operation: "set", value: cookies }
          ]
        },
        condition: {
          urlFilter: "*googlevideo.com*",
          resourceTypes: ["xmlhttprequest", "other"]
        }
      }]
    });
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return JSON.stringify({ cookieLen: rules[0]?.action?.requestHeaders?.find(h => h.header === "Cookie")?.value?.length });
  })()`);
  console.log("DNR rule updated:", updateResult);

  // Step 3: Make a real test fetch from the SW to googlevideo
  const fetchResult = await cdpEvalSW(`(async () => {
    try {
      const r = await fetch("https://rr2---sn-nhpax-ua8d.googlevideo.com/videoplayback?test=1", {
        method: "POST",
        headers: { "content-type": "application/x-protobuf", "accept": "application/vnd.yt-ump" },
        body: new Uint8Array([0])
      });
      return JSON.stringify({ status: r.status, type: r.type });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  })()`);
  console.log("Test fetch result:", fetchResult);
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e); process.exit(1);
});
