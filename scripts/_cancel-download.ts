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

const result = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const grp = document.querySelector('[data-ytdl-download-group]');
    const btn = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
    const label = btn ? btn.getAttribute('aria-label') : null;
    if (label === 'Cancel download') {
      btn.click();
      return { label, clicked: true };
    }
    return { label, clicked: false };
  })())`
);

console.log("Result:", result);
rdp.destroy();
