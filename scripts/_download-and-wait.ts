import { findFirefoxRdpPort, RDP, isFirefoxTab, isRecord } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 180; // 15 minutes

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
if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
  console.error("no consoleActor"); rdp.destroy(); process.exit(1);
}
const consoleActor = frame.consoleActor;

const clickResult = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const grp = document.querySelector('[data-ytdl-download-group]');
    const btn = grp?.querySelector('yt-button-view-model:first-child button');
    const label = btn?.getAttribute('aria-label') ?? '';
    btn?.click();
    return { clicked: !!btn, label };
  })())`
);
console.log("Click:", clickResult);

if (typeof clickResult === "string" && clickResult.includes('"clicked":false')) {
  console.error("button not found"); rdp.destroy(); process.exit(1);
}

for (let i = 0; i < MAX_POLLS; i++) {
  await wait(POLL_INTERVAL_MS);
  const stateJson = await rdp.evalInTab(consoleActor,
    `JSON.stringify((() => {
      const grp = document.querySelector('[data-ytdl-download-group]');
      const btn = grp?.querySelector('yt-button-view-model:first-child button');
      const label = btn?.getAttribute('aria-label') ?? '';
      const prog = grp?.querySelector('tp-yt-paper-progress')?.getAttribute('value');
      return { label, progress: prog };
    })())`
  );
  const state = JSON.parse(stateJson as string);
  const elapsed = (i + 1) * (POLL_INTERVAL_MS / 1000);
  console.log(`T+${elapsed}s: label="${state.label}" progress=${state.progress ?? "n/a"}`);
  const lbl = (state.label as string).toLowerCase();
  if (lbl.includes("downloaded") || lbl.includes("download again") || lbl.includes("open")) {
    console.log("DONE");
    rdp.destroy();
    process.exit(0);
  }
  if (lbl.includes("deleted") || lbl.includes("failed") || lbl.includes("error")) {
    console.log("FAILED:", state.label);
    rdp.destroy();
    process.exit(2);
  }
}
console.log("Timed out");
rdp.destroy();
process.exit(1);
