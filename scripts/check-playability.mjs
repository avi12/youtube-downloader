import WebSocket from "ws";
const PORT = Number(process.argv[2] ?? 9229);
function openSocket(url) { return new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res(s); s.onerror = e => rej(e); }); }
function send(s, method, params = {}) { return new Promise((res, rej) => { const id = Math.floor(Math.random()*1e9); s.addEventListener('message', function onM(e){ const d = JSON.parse(String(e.data)); if (d.id !== id) return; s.removeEventListener('message', onM); if (d.error) rej(d.error); else res(d.result); }); s.send(JSON.stringify({ id, method, params })); }); }

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const yt = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));
  if (!yt) { console.log("no yt"); return; }
  const s = await openSocket(yt.webSocketDebuggerUrl);
  const r = await send(s, "Runtime.evaluate", {
    expression: `
      ({
        playabilityStatus: window.ytInitialPlayerResponse?.playabilityStatus,
        videoDetails: { videoId: window.ytInitialPlayerResponse?.videoDetails?.videoId, lengthSeconds: window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds, title: window.ytInitialPlayerResponse?.videoDetails?.title },
        ytpError: document.querySelector('.ytp-error')?.textContent?.slice(0, 200),
        moviePlayer: !!document.querySelector('#movie_player'),
        videoEl: { exists: !!document.querySelector('video'), duration: document.querySelector('video')?.duration, readyState: document.querySelector('video')?.readyState, error: document.querySelector('video')?.error?.message }
      })
    `,
    returnByValue: true
  });
  console.log(JSON.stringify(r.result?.value, null, 2));
  s.close();
})();
