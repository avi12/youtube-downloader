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

// Check document.cookie and also check whether a SYNTHETIC template request works
await rdp.evalInTab(consoleActor,
  `(function() {
    // Try synthesizing a fresh template from player
    const sabr = window.__ytdlSabr;
    const synth = sabr ? sabr.synthesize() : null;
    const tmpl = window.__ytdlSabrTemplate;
    console.log('[cookie-test] yt cookies:', document.cookie.length > 0 ? document.cookie.slice(0, 100) : 'none');
    console.log('[cookie-test] template age:', tmpl ? Math.round((Date.now() - tmpl.capturedAt)/1000) + 's' : 'none');
    console.log('[cookie-test] synth template:', synth ? 'yes url=' + synth.url.slice(0, 80) : 'no');
    if (synth) {
      const url = new URL(synth.url);
      url.searchParams.set('rn', '1');
      url.searchParams.set('alr', 'yes');
      const body = Uint8Array.from(atob(synth.bodyBase64), c => c.charCodeAt(0));
      fetch(url.toString(), {
        method: 'POST',
        body,
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.timeout(15000)
      }).then(async r => {
        const ab = await r.arrayBuffer();
        console.log('[cookie-test] SYNTH fetch: status=' + r.status + ' size=' + ab.byteLength);
      }).catch(e => {
        console.log('[cookie-test] SYNTH fetch error:', String(e));
      });
    }
  })()`
);

const msgs: string[] = [];
rdp.onEvent = (p: any) => {
  if (p.type === "consoleAPICall") {
    const args = (p.message?.arguments ?? []).map((a: any) => String(a.value ?? a)).join(" ");
    if (args.includes("cookie-test")) { msgs.push(args); console.log(">>", args); }
  }
};

await new Promise(r => setTimeout(r, 20_000));
if (!msgs.length) console.log("No messages");
rdp.destroy();
