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

// Trigger a test fetch and store result including response body
await rdp.evalInTab(consoleActor,
  `(function() {
    const tmpl = window.__ytdlSabrTemplate;
    if (!tmpl) { console.error('[ytdl-test] no template'); return; }
    const url = new URL(tmpl.url);
    url.searchParams.set('rn', '99');
    url.searchParams.set('alr', 'yes');
    fetch(url.toString(), {
      method: 'POST',
      body: tmpl.body,
      mode: 'cors',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000)
    }).then(async r => {
      const text = await r.text().catch(() => '(unreadable)');
      console.log('[ytdl-test] FETCH status=' + r.status + ' size=' + text.length + ' body=' + text.slice(0, 200));
    }).catch(e => {
      console.error('[ytdl-test] FETCH error:', String(e));
    });
  })()`
);

console.log("Triggered fetch. Reading console for 20s...");

// Listen to console events for 20 seconds
await rdp.request(consoleActor, "startListeners", { listeners: ["ConsoleAPI"] });

const messages: string[] = [];
rdp.onEvent = (packet) => {
  if (packet.type === "consoleAPICall") {
    const call = packet as Record<string, any>;
    const args = (call.message?.arguments ?? []).map((a: any) => String(a.value ?? a)).join(" ");
    if (args.includes("ytdl-test")) {
      messages.push(args);
      console.log("Console:", args);
    }
  }
};

await new Promise(r => setTimeout(r, 20_000));

if (messages.length === 0) {
  console.log("No ytdl-test messages received");
}

rdp.destroy();
