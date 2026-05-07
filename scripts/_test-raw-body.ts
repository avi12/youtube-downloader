import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const rdp = new RDP(findFirefoxRdpPort()!);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

// Store results in window and poll
await rdp.evalInTab(consoleActor,
  `(function() {
    const tmpl = window.__ytdlSabrTemplate;
    window.__ytdlRawTest = { done: false, status: null, size: null, error: null };
    if (!tmpl) { window.__ytdlRawTest.error = 'no template'; return; }
    // Use EXACT same body as captured (no decode/re-encode)
    const url = new URL(tmpl.url);
    url.searchParams.set('rn', '1');
    url.searchParams.set('alr', 'yes');
    // Need fresh copy of body
    const body = new Uint8Array(tmpl.body.buffer.slice(0));
    fetch(url.toString(), {
      method: 'POST',
      body,
      mode: 'cors',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000)
    }).then(async r => {
      const ab = await r.arrayBuffer();
      window.__ytdlRawTest = { done: true, status: r.status, size: ab.byteLength, error: null };
    }).catch(e => {
      window.__ytdlRawTest = { done: true, status: null, size: null, error: String(e) };
    });
  })()`
);

// Poll every 3s for up to 18s
for (let i = 0; i < 6; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const result = await rdp.evalInTab(consoleActor, `JSON.stringify(window.__ytdlRawTest)`);
  console.log(`T+${(i+1)*3}s:`, result);
  const r = JSON.parse(result);
  if (r.done) break;
}

rdp.destroy();
