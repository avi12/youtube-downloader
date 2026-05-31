import WebSocket from "ws";
const PORT = Number(process.argv[2] ?? 9229);
function openSocket(url) { return new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res(s); s.onerror = e => rej(e); }); }
function send(s, method, params = {}) { return new Promise((res, rej) => { const id = Math.floor(Math.random()*1e9); s.addEventListener('message', function onM(e){ const d = JSON.parse(String(e.data)); if (d.id !== id) return; s.removeEventListener('message', onM); if (d.error) rej(d.error); else res(d.result); }); s.send(JSON.stringify({ id, method, params })); }); }

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const yt = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));
  const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));

  if (yt) {
    const s = await openSocket(yt.webSocketDebuggerUrl);
    const r = await send(s, "Runtime.evaluate", {
      expression: `
        ({
          ytdlAnchor: !!document.querySelector('.ytdl-download-button, .ytdl-chevron-button, [class*="ytdl-"]'),
          ytdlClasses: [...new Set([...document.querySelectorAll('[class*="ytdl-"]')].map(e => [...e.classList].filter(c => c.startsWith('ytdl-'))).flat())],
          actionsInnerHTML: document.querySelector('div#actions-inner')?.innerHTML?.slice(0, 500),
          readyState: document.readyState,
          url: location.href,
          videoLoaded: !!document.querySelector('video')?.duration
        })
      `,
      returnByValue: true
    });
    console.log("YT eval:", JSON.stringify(r.result?.value, null, 2));

    // Capture SW console / errors from yt page logs
    const consoleMsgs = await send(s, "Runtime.evaluate", {
      expression: `
        (async () => {
          const errs = [];
          if (window.__ytdlErrors) errs.push(...window.__ytdlErrors);
          return errs;
        })()
      `,
      returnByValue: true,
      awaitPromise: true
    });
    console.log("YT errors:", JSON.stringify(consoleMsgs.result?.value, null, 2));
    s.close();
  }

  if (sw) {
    const s = await openSocket(sw.webSocketDebuggerUrl);
    const r = await send(s, "Runtime.evaluate", {
      expression: `
        ({
          alive: true,
          extId: chrome.runtime.id,
          manifest: { version: chrome.runtime.getManifest().version, name: chrome.runtime.getManifest().name }
        })
      `,
      returnByValue: true
    });
    console.log("SW eval:", JSON.stringify(r.result?.value, null, 2));
    s.close();
  } else {
    console.log("SW not found");
  }
})();
