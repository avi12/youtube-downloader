import WebSocket from "ws";

const port = Number(process.argv[2] ?? 9229);

async function cdp(wsUrl, method, params = {}) {
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
    setTimeout(() => { if (!done) { ws.close(); resolve(null); } }, 8000);
  });
}

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const ytTab = targets.find(t => t.type === "page" && t.url.includes("youtube.com/watch"));
if (!ytTab) {
  console.error("no YT tab found");
  process.exit(1);
}

// Click the extension download button by class selector (M3 Expressive). Walk shadow DOM as needed.
const expr = `
(() => {
  const candidates = [...document.querySelectorAll('button')]
    .filter(el => /^(Download|Stop download|Retry|Failed)/.test(el.getAttribute('aria-label') || el.textContent || ''));
  const el = candidates.find(b => /^Download$/.test((b.getAttribute('aria-label') || '').trim()));
  if (!el) return { ok: false, found: candidates.map(b => b.getAttribute('aria-label') || b.textContent?.trim()) };
  el.click();
  return { ok: true };
})()
`;

const r = await cdp(ytTab.webSocketDebuggerUrl, "Runtime.evaluate", {
  expression: expr,
  returnByValue: true
});
console.log(JSON.stringify(r?.result?.result?.value ?? r, null, 2));
