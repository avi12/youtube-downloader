import WebSocket from "ws";
const PORT = Number(process.argv[2] ?? 9229);
function openSocket(url) { return new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res(s); s.onerror = e => rej(e); }); }
function send(s, method, params = {}) { return new Promise((res, rej) => { const id = Math.floor(Math.random()*1e9); s.addEventListener('message', function onM(e){ const d = JSON.parse(String(e.data)); if (d.id !== id) return; s.removeEventListener('message', onM); if (d.error) rej(d.error); else res(d.result); }); s.send(JSON.stringify({ id, method, params })); }); }

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
  if (!sw) { console.log("no SW"); return; }
  const s = await openSocket(sw.webSocketDebuggerUrl);
  const r = await send(s, "Runtime.evaluate", {
    expression: `
      new Promise(res => {
        chrome.downloads.search({ limit: 10, orderBy: ['-startTime'] }, items => {
          res(items.map(it => ({
            id: it.id,
            filename: it.filename,
            state: it.state,
            danger: it.danger,
            paused: it.paused,
            startTime: it.startTime,
            endTime: it.endTime,
            url: it.url,
            referrer: it.referrer,
            bytesReceived: it.bytesReceived,
            totalBytes: it.totalBytes,
            fileSize: it.fileSize,
            exists: it.exists
          })));
        });
      })
    `,
    returnByValue: true,
    awaitPromise: true
  });
  console.log(JSON.stringify(r.result?.value, null, 2));
  s.close();
})();
