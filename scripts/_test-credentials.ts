import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const port = findFirefoxRdpPort();
if (!port) { console.error("no RDP port"); process.exit(1); }

const rdp = new RDP(port);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { console.error("no YT tab"); rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

await rdp.request(consoleActor, "startListeners", { listeners: ["ConsoleAPI"] });

// Test with credentials: include
await rdp.evalInTab(consoleActor,
  `(function() {
    const tmpl = window.__ytdlSabrTemplate;
    if (!tmpl) { console.log('[cred-test] no template'); return; }
    const url = new URL(tmpl.url);
    url.searchParams.set('rn', '100');
    url.searchParams.set('alr', 'yes');
    fetch(url.toString(), {
      method: 'POST',
      body: tmpl.body,
      mode: 'cors',
      credentials: 'include',
      signal: AbortSignal.timeout(15000)
    }).then(async r => {
      const ab = await r.arrayBuffer();
      console.log('[cred-test] include: status=' + r.status + ' size=' + ab.byteLength);
    }).catch(e => {
      console.log('[cred-test] include: error=' + String(e));
    });
    fetch(url.toString(), {
      method: 'POST',
      body: tmpl.body,
      mode: 'cors',
      credentials: 'omit',
      signal: AbortSignal.timeout(15000)
    }).then(async r => {
      const ab = await r.arrayBuffer();
      console.log('[cred-test] omit: status=' + r.status + ' size=' + ab.byteLength);
    }).catch(e => {
      console.log('[cred-test] omit: error=' + String(e));
    });
  })()`
);

console.log("Tests fired. Waiting 20s...");
const msgs: string[] = [];
rdp.onEvent = (p: any) => {
  if (p.type === "consoleAPICall") {
    const args = (p.message?.arguments ?? []).map((a: any) => String(a.value ?? a)).join(" ");
    if (args.includes("cred-test")) { msgs.push(args); console.log(">>", args); }
  }
};

await new Promise(r => setTimeout(r, 20_000));
if (!msgs.length) console.log("No messages received");
rdp.destroy();
