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

// Read ytdl debug log from window
const logResult = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const log = window.__ytdlDebugLog;
    if (!Array.isArray(log)) return { count: 0, entries: [] };
    const recent = log.slice(-30);
    return { count: log.length, entries: recent };
  })())`
);
console.log("Debug log:", logResult);

rdp.destroy();
