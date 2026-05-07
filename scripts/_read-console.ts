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
const frame = target.frame;
const consoleActor = (frame as Record<string, unknown>).consoleActor as string;

// Get recent console messages
const msgRes = await rdp.request(consoleActor, "startListeners", { listeners: ["PageError", "ConsoleAPI"] });
console.log("Listeners:", JSON.stringify(msgRes).slice(0, 200));

// Check for ytdl messages via evaluation
const logs = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    return window.__ytdlLogs || 'no logs';
  })())`
);
console.log("ytdl logs:", logs);

// Check button state
const btn = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const grp = document.querySelector('[data-ytdl-download-group]');
    const b = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
    return { label: b ? b.getAttribute('aria-label') : null };
  })())`
);
console.log("Button:", btn);

rdp.destroy();
