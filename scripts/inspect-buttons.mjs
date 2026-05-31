import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 9229);

function openSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(wsUrl);
    s.onopen = () => resolve(s);
    s.onerror = e => reject(new Error(e.message ?? String(e)));
  });
}
function cdpSend(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = e => {
      const data = JSON.parse(String(e.data));
      if (data.id !== id) return;
      socket.removeEventListener("message", onMsg);
      if (data.error) reject(new Error(`${method}: ${data.error.message}`));
      else resolve(data.result);
    };
    socket.addEventListener("message", onMsg);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const yt = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));
  if (!yt) { console.log("no yt"); return; }

  const s = await openSocket(yt.webSocketDebuggerUrl);
  try {
    const r = await cdpSend(s, "Runtime.evaluate", {
      expression: `
        (() => {
          const out = [];
          for (const btn of document.querySelectorAll('button')) {
            const aria = btn.getAttribute('aria-label') || '';
            const text = (btn.textContent || '').trim().slice(0, 60);
            if (!/download|stop|retry|failed/i.test(aria + ' ' + text)) continue;
            // walk up and capture parent chain
            const chain = [];
            let cur = btn;
            for (let i = 0; i < 8 && cur; i++) {
              const id = cur.id ? '#' + cur.id : '';
              const cls = cur.className && typeof cur.className === 'string' ? '.' + cur.className.split(/\\s+/).slice(0,3).join('.') : '';
              chain.push(cur.tagName?.toLowerCase() + id + cls);
              cur = cur.parentElement;
            }
            out.push({ aria, text, chain: chain.join(' > ') });
          }
          return out;
        })()
      `,
      returnByValue: true
    });
    console.log(JSON.stringify(r.result?.value, null, 2));
  } finally { s.close(); }
})();
