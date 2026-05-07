import { findFirefoxRdpPort, RDP, isFirefoxTab, isRecord } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

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

const clickResult = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const grp = document.querySelector('[data-ytdl-download-group]');
    const btn = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
    if (btn) { btn.click(); return { clicked: true, label: btn.getAttribute('aria-label') }; }
    return { clicked: false };
  })())`
);
console.log("Click:", clickResult);

const startTime = Date.now();
const maxDurationMs = 10 * 60 * 1000;
let lastLabel = "";
while (Date.now() - startTime < maxDurationMs) {
  await wait(5000);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const state = await rdp.evalInTab(consoleActor,
    `JSON.stringify((() => {
      const grp = document.querySelector('[data-ytdl-download-group]');
      const btn = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
      const label = btn ? btn.getAttribute('aria-label') : null;
      return { label, grpFound: !!grp };
    })())`
  );
  let parsed: { label: string | null; grpFound: boolean } = { label: null, grpFound: false };
  try { parsed = JSON.parse(state); } catch(_) {}
  if (parsed.label !== lastLabel) {
    console.log(`T+${elapsed}s: label="${parsed.label}"`);
    lastLabel = parsed.label ?? "";
  }
  if (parsed.label === "Download" && elapsed > 10) {
    console.log("Download complete!");
    break;
  }
}

rdp.destroy();
