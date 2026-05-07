import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const rdp = new RDP(findFirefoxRdpPort()!);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

// Record old template age
const before = await rdp.evalInTab(consoleActor,
  `JSON.stringify({ age: window.__ytdlSabrTemplate ? Math.round((Date.now()-window.__ytdlSabrTemplate.capturedAt)/1000) : null })`
);
console.log("Template before:", before);

// Seek the video to force new SABR request
await rdp.evalInTab(consoleActor,
  `(function() { const v = document.querySelector('video'); if (v) v.currentTime = 5; })()`
);

// Wait for new template to be captured
let freshAge = 999;
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const check = JSON.parse(await rdp.evalInTab(consoleActor,
    `JSON.stringify({ age: window.__ytdlSabrTemplate ? Math.round((Date.now()-window.__ytdlSabrTemplate.capturedAt)/1000) : null })`
  ));
  freshAge = check.age ?? 999;
  console.log(`T+${i+1}s: template age=${freshAge}s`);
  if (freshAge < 5) break;
}

if (freshAge > 10) {
  console.log("Template not refreshed, trying different seek position");
  await rdp.evalInTab(consoleActor,
    `(function() { const v = document.querySelector('video'); if (v) { v.currentTime = 60; v.play(); } })()`
  );
  await new Promise(r => setTimeout(r, 5000));
  const check = JSON.parse(await rdp.evalInTab(consoleActor,
    `JSON.stringify({ age: window.__ytdlSabrTemplate ? Math.round((Date.now()-window.__ytdlSabrTemplate.capturedAt)/1000) : null })`
  ));
  freshAge = check.age ?? 999;
  console.log("After second seek, template age:", freshAge);
}

// Now try fetch with fresh template
await rdp.evalInTab(consoleActor,
  `(function() {
    const v = document.querySelector('video'); if (v) v.pause();
    const tmpl = window.__ytdlSabrTemplate;
    window.__ytdlFreshTest = { started: true, status: null };
    if (!tmpl) { window.__ytdlFreshTest = { error: 'no template' }; return; }
    const url = new URL(tmpl.url);
    url.searchParams.set('rn', '1');
    url.searchParams.set('alr', 'yes');
    const body = new Uint8Array(tmpl.body.buffer.slice(0));
    fetch(url.toString(), { method: 'POST', body, mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(15000) })
      .then(async r => {
        const ab = await r.arrayBuffer();
        window.__ytdlFreshTest = { status: r.status, size: ab.byteLength, templateAge: Math.round((Date.now()-tmpl.capturedAt)/1000) };
      }).catch(e => {
        window.__ytdlFreshTest = { error: String(e) };
      });
  })()`
);

for (let i = 0; i < 6; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const r = await rdp.evalInTab(consoleActor, `JSON.stringify(window.__ytdlFreshTest)`);
  const parsed = JSON.parse(r);
  console.log(`T+${(i+1)*3}s:`, r);
  if (parsed.status !== null && parsed.status !== undefined) break;
  if (parsed.error) break;
}

rdp.destroy();
