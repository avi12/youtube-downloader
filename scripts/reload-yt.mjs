import WebSocket from "ws";
const PORT = Number(process.argv[2] ?? 9229);
function openSocket(url) { return new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res(s); s.onerror = e => rej(e); }); }
function send(s, method, params = {}) { return new Promise((res, rej) => { const id = Math.floor(Math.random()*1e9); s.addEventListener('message', function onM(e){ const d = JSON.parse(String(e.data)); if (d.id !== id) return; s.removeEventListener('message', onM); if (d.error) rej(d.error); else res(d.result); }); s.send(JSON.stringify({ id, method, params })); }); }

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const yt = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));
  if (!yt) { console.log("no yt"); return; }
  const s = await openSocket(yt.webSocketDebuggerUrl);
  await send(s, "Page.reload", { ignoreCache: false });
  s.close();
  console.log("reloaded");
})();
