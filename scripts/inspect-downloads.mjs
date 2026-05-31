import WebSocket from "ws";
const PORT = Number(process.argv[2] ?? 9229);
function openSocket(url) { return new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res(s); s.onerror = e => rej(e); }); }
function send(s, method, params = {}) { return new Promise((res, rej) => { const id = Math.floor(Math.random()*1e9); s.addEventListener('message', function onM(e){ const d = JSON.parse(String(e.data)); if (d.id !== id) return; s.removeEventListener('message', onM); if (d.error) rej(d.error); else res(d.result); }); s.send(JSON.stringify({ id, method, params })); }); }

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const dl = targets.find(t => t.type === "page" && (t.url ?? "").startsWith("chrome://downloads"));
  if (!dl) { console.log("no downloads tab"); return; }
  const s = await openSocket(dl.webSocketDebuggerUrl);
  // 1) Force a reload of the downloads page so it queries the latest
  await send(s, "Page.reload", {});
  await new Promise(r => setTimeout(r, 1500));
  // 2) Inspect items
  const r = await send(s, "Runtime.evaluate", {
    expression: `
      (async () => {
        const mgr = document.querySelector('downloads-manager');
        if (!mgr) return { hasMgr: false };
        const list = mgr.shadowRoot?.querySelector('iron-list');
        const items = list?.items ?? [];
        const totalSize = items.length;
        const all = items.slice(0, 15).map(it => ({
          id: it.id,
          state: it.state,
          danger_type: it.danger_type,
          percent: it.percent,
          file_name: it.file_name,
          file_path: it.file_path,
          file_url: it.file_url,
          last_reason_text: it.last_reason_text,
          received_bytes: it.received_bytes,
          total_bytes: it.total_bytes,
          since_string: it.since_string,
          date_string: it.date_string,
          referrer_url: it.referrer_url
        }));
        return { hasMgr: true, totalSize, items: all };
      })()
    `,
    returnByValue: true,
    awaitPromise: true
  });
  console.log(JSON.stringify(r.result?.value, null, 2));
  s.close();
})();
