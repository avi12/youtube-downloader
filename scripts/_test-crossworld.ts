import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const rdp = new RDP(findFirefoxRdpPort()!);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

// Check if the RunProgressiveSabr handler has been triggered
// by checking window.__ytdlRunProgressiveSabrCount (we'll set this up first via a flag check)
const checkFlag = await rdp.evalInTab(consoleActor,
  `JSON.stringify({ count: window.__ytdlProgressiveSabrReceived ?? 0 })`
);
console.log("Pre-download check:", checkFlag);

// Now click download to trigger the flow
const click = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const grp = document.querySelector('[data-ytdl-download-group]');
    const btn = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
    const label = btn ? btn.getAttribute('aria-label') : null;
    if (label === 'Download') { btn.click(); return { clicked: true }; }
    if (label === 'Cancel download') { btn.click(); return { cancelled: true }; }
    return { label };
  })())`
);
console.log("Click:", click);

// Wait 10s then check if RunProgressiveSabr message was received
await new Promise(r => setTimeout(r, 10_000));

const postCheck = await rdp.evalInTab(consoleActor,
  `JSON.stringify({ count: window.__ytdlProgressiveSabrReceived ?? 0, fetchCalled: window.__ytdlFetchProgressiveCalled ?? 0 })`
);
console.log("Post-download check (10s):", postCheck);

// Check button state
const btnState = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); return b?.getAttribute('aria-label'); })()`
);
console.log("Button state:", btnState);

rdp.destroy();
