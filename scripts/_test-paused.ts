import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const rdp = new RDP(findFirefoxRdpPort()!);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

// Cancel any active download
await rdp.evalInTab(consoleActor,
  `(function() { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Cancel download') b.click(); })()`
);
await new Promise(r => setTimeout(r, 2000));

// Pause the player
const pauseResult = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const player = document.querySelector('video');
    if (!player) return 'no player';
    if (!player.paused) { player.pause(); return 'paused'; }
    return 'already paused';
  })())`
);
console.log("Pause result:", pauseResult);

await new Promise(r => setTimeout(r, 2000));

// Now try raw fetch with the template body
window.__ytdlPausedTest = null;
await rdp.evalInTab(consoleActor,
  `(function() {
    const tmpl = window.__ytdlSabrTemplate;
    if (!tmpl) { window.__ytdlPausedTest = 'no template'; return; }
    const url = new URL(tmpl.url);
    url.searchParams.set('rn', '1');
    url.searchParams.set('alr', 'yes');
    const body = new Uint8Array(tmpl.body.buffer.slice(0));
    fetch(url.toString(), { method: 'POST', body, mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(15000) })
      .then(async r => {
        const ab = await r.arrayBuffer();
        window.__ytdlPausedTest = { status: r.status, size: ab.byteLength };
      }).catch(e => { window.__ytdlPausedTest = { error: String(e) }; });
  })()`
);

for (let i = 0; i < 6; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const r = await rdp.evalInTab(consoleActor, `JSON.stringify(window.__ytdlPausedTest)`);
  console.log(`T+${(i+1)*3}s:`, r);
  if (r !== 'null') break;
}

// Resume player
await rdp.evalInTab(consoleActor,
  `(function() { const player = document.querySelector('video'); player?.play(); })()`
);

rdp.destroy();
