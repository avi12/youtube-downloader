/**
 * Polls until the extension's download button shows "Download" again (not "Cancel"),
 * indicating the download finished or failed. Outputs the latest MKV filename.
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { DOWNLOADS as DL_DIR } from "./script-config";
const MAX_WAIT_MS = 600_000;
const POLL_MS = 8_000;

const port = findFirefoxRdpPort();
if (!port) throw new Error("no port");
const rdp = new RDP(port);
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no yt tab");
const ca = await rdp.getConsoleActor(ytTab.actor);

const started = Date.now();
let elapsed = 0;

while (elapsed < MAX_WAIT_MS) {
  const status = await rdp.evalInTab(ca, `(function() {
    var group = document.querySelector("[data-ytdl-download-group]");
    if (!group) return "no-group";
    var btn = group.querySelector("button");
    var label = btn ? (btn.getAttribute("aria-label") || btn.textContent || "").trim() : "no-btn";
    return label;
  })()`);
  elapsed = Date.now() - started;
  console.log("T+" + Math.round(elapsed / 1000) + "s: " + status);

  if (typeof status === "string" && !status.toLowerCase().includes("cancel") && status !== "no-group" && status !== "no-btn") {
    console.log("DONE: download finished");
    break;
  }
  await wait(POLL_MS);
}

// Find newest MKV
const mkvs = readdirSync(DL_DIR)
  .filter(f => f.endsWith(".mkv"))
  .map(f => ({ f, mtime: statSync(join(DL_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (mkvs.length) {
  console.log("NEWEST_MKV:" + join(DL_DIR, mkvs[0].f));
} else {
  console.log("NO_MKV_FOUND");
}

rdp.destroy();
