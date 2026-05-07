import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const rdp = new RDP(findFirefoxRdpPort()!);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

// First cancel any active download
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const g=document.querySelector('[data-ytdl-download-group]');
    const b=g?.querySelector('yt-button-view-model:first-child button');
    const l=b?.getAttribute('aria-label');
    if (l==='Cancel download') b.click();
    return l;
  })())`
);
await new Promise(r => setTimeout(r, 2000));

// Set up a spy on ALL ytdl custom events in MAIN world
await rdp.evalInTab(consoleActor,
  `(function() {
    window.__ytdlEventSpy = [];
    const origAddEvent = window.addEventListener.bind(window);
    // Listen for all events with ytdl in name
    ['ytdl-RunProgressiveSabr', 'ytdl_RunProgressiveSabr', 'ytdl:RunProgressiveSabr'].forEach(name => {
      window.addEventListener(name, e => {
        window.__ytdlEventSpy.push({ name, detailType: typeof e.detail, detail: e.detail ? 'has-detail' : 'null' });
      }, true);
    });
    // Also listen broadly for any ytdl-prefixed event
    window.addEventListener('CustomEvent', e => {
      if (e.type?.includes('ytdl')) window.__ytdlEventSpy.push({ type: e.type });
    }, true);
    console.log('[spy] Event spy installed');
  })()`
);

// Now trigger download
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const g=document.querySelector('[data-ytdl-download-group]');
    const b=g?.querySelector('yt-button-view-model:first-child button');
    const l=b?.getAttribute('aria-label');
    if (l==='Download') b.click();
    return { l };
  })())`
);

console.log("Download triggered. Waiting 15s...");
await new Promise(r => setTimeout(r, 15_000));

const events = await rdp.evalInTab(consoleActor, `JSON.stringify(window.__ytdlEventSpy)`);
console.log("Events caught:", events);

const btnState = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); return { label: b?.getAttribute('aria-label') }; })())`
);
console.log("Button:", btnState);

// Cancel
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Cancel download') b.click(); return 'ok'; })())`
);

rdp.destroy();
