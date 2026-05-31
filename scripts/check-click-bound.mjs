import WebSocket from "ws";
const PORT = Number(process.argv[2] ?? 9229);
function openSocket(url) { return new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res(s); s.onerror = e => rej(e); }); }
function send(s, method, params = {}) { return new Promise((res, rej) => { const id = Math.floor(Math.random()*1e9); s.addEventListener('message', function onM(e){ const d = JSON.parse(String(e.data)); if (d.id !== id) return; s.removeEventListener('message', onM); if (d.error) rej(d.error); else res(d.result); }); s.send(JSON.stringify({id,method,params})); }); }

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const yt = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));
  const s = await openSocket(yt.webSocketDebuggerUrl);
  const r = await send(s, "Runtime.evaluate", {
    expression: `
      (() => {
        const dl = document.querySelector('.ytdl-download-button');
        if (!dl) return { dl: null };
        const wrapper = dl.matches('button-view-model') ? dl : dl.closest('button-view-model') ?? dl;
        const inner = dl.querySelector('button');
        return {
          dlTag: dl.tagName,
          dlClasses: dl.className,
          dlAttrs: dl.getAttributeNames(),
          wrapperTag: wrapper.tagName,
          wrapperAttrs: wrapper.getAttributeNames(),
          wrapperIsBound: wrapper.hasAttribute('data-ytdl-click-bound'),
          innerTag: inner?.tagName,
          innerText: inner?.textContent?.trim().slice(0, 60),
          innerAriaLabel: inner?.getAttribute('aria-label')
        };
      })()
    `,
    returnByValue: true
  });
  console.log(JSON.stringify(r.result?.value, null, 2));
  s.close();
})();
