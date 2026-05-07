import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const port = findFirefoxRdpPort();
if (!port) { console.error("no RDP port"); process.exit(1); }

const rdp = new RDP(port);
await rdp.connect();

const res = await rdp.request("root", "listTabs");
const tabs = (Array.isArray(res.tabs) ? res.tabs : []).filter(isFirefoxTab);
const yt = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!yt) { console.error("no YT tab"); rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as Record<string, unknown>).consoleActor as string;

// Trigger a single SABR fetch to see if it goes through
const result = await rdp.evalInTab(consoleActor,
  `JSON.stringify((async () => {
    const tmpl = window.__ytdlSabrTemplate;
    if (!tmpl) return { error: 'no template' };
    try {
      const r = await fetch(tmpl.url + '&rn=1&alr=yes', {
        method: 'POST',
        body: tmpl.body,
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.timeout(10000)
      });
      return { status: r.status, ok: r.ok, size: (await r.arrayBuffer()).byteLength };
    } catch (e) {
      return { error: String(e) };
    }
  })())`
, 15000);

console.log("Test fetch result:", result);
rdp.destroy();
