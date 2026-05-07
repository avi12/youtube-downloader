/**
 * Full reference frame capture for Phase 2 SSIM.
 * For each timestamp: reload page, scroll top, seek, save screenshot crop.
 * Outputs: TEMP_DIR/frame_N_ref.png (cropped to video area)
 *
 * The CHROME_H (browser chrome height in screenshot) was calibrated as 85px.
 *
 * Usage: bun scripts/_capture-ref-frames-all.ts <t0> <t1> ...
 * After running, invoke SSIM manually or via verify-identity-full.ts.
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { FFMPEG, TEMP_DIR } from "./script-config";
const CHROME_H = 85;
const SEEK_SETTLE_MS = 3_500;

mkdirSync(TEMP_DIR, { recursive: true });

const timestamps = process.argv.slice(2).map(Number);
if (!timestamps.length) {
  console.error("Usage: bun scripts/_capture-ref-frames-all.ts <t1> <t2> ...");
  process.exit(1);
}

// This script writes screenshot paths to stdout for the caller to read.
// The caller (the conversation) uses screenshot_page MCP tool after each seek.
// Format: READY:<index>:<tSec>:<x>:<y+CHROME_H>:<w>:<h>:<screenshotPath>

const port = findFirefoxRdpPort();
if (!port) throw new Error("no Firefox RDP port");
const rdp = new RDP(port);
await rdp.connect();

async function reconnectTab(): Promise<{ ca: string; ytTab: { actor: string; url?: string } }> {
  const tabs = await rdp.listTabs();
  const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
  if (!ytTab) throw new Error("no YouTube watch tab");
  const ca = await rdp.getConsoleActor(ytTab.actor);
  return { ca, ytTab };
}

async function scrollToTop(ca: string) {
  // Try multiple scroll container candidates
  await rdp.evalInTab(ca, `(function() {
    var containers = [
      document.querySelector('ytd-app'),
      document.querySelector('#page-manager'),
      document.querySelector('#content'),
      document.documentElement,
      document.body
    ];
    for (var i = 0; i < containers.length; i++) {
      if (containers[i]) containers[i].scrollTop = 0;
    }
    window.scrollTo(0, 0);
  })()`);
  await wait(500);
}

async function waitForVideo(ca: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await rdp.evalInTab(ca, `(function() {
      var v = document.querySelector('#movie_player video') || document.querySelector('video');
      if (!v) return 'no-video';
      return 'rs-' + v.readyState;
    })()`);
    if (typeof state === "string" && state.startsWith("rs-") && state !== "rs-0") return true;
    await wait(800);
  }
  return false;
}

let { ca } = await reconnectTab();

// Reload once to start fresh
console.log("Reloading page...");
await rdp.evalInTab(ca, `location.reload()`);
await wait(5000);
({ ca } = await reconnectTab());
await waitForVideo(ca);

for (const [i, t] of timestamps.entries()) {
  console.log(`\n--- Frame ${i + 1}/${timestamps.length} at t=${t}s ---`);

  // Scroll to top
  await scrollToTop(ca);
  await wait(300);

  // Seek using video.currentTime directly
  await rdp.evalInTab(ca, `(function() {
    var v = document.querySelector('#movie_player video') || document.querySelector('video');
    if (!v) return;
    v.pause();
    v.currentTime = ${t};
  })()`);

  await wait(SEEK_SETTLE_MS);

  // Get bounds
  const boundsRaw = await rdp.evalInTab(ca, `(function() {
    var v = document.querySelector('#movie_player video') || document.querySelector('video');
    if (!v) return JSON.stringify({error:"no video"});
    var r = v.getBoundingClientRect();
    return JSON.stringify({
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      time: v.currentTime.toFixed(2)
    });
  })()`);

  console.log("bounds:", boundsRaw);

  let bounds: { x: number; y: number; w: number; h: number; time: string } | null = null;
  try {
    const parsed = JSON.parse(typeof boundsRaw === "string" ? boundsRaw : "null");
    if (parsed && !parsed.error && parsed.y >= 0) bounds = parsed;
    else if (parsed) console.log("bounds issue:", JSON.stringify(parsed));
  } catch {
    console.log("bounds parse error:", boundsRaw);
  }

  if (!bounds) {
    console.log(`frame ${i + 1}: skipping (video out of viewport)`);
    continue;
  }

  // Emit READY signal with crop info - the conversation will screenshot then crop
  const screenshotPath = join(TEMP_DIR, `screenshot_${i}.png`).replace(/\\/g, "/");
  const cropY = CHROME_H + bounds.y;
  console.log(`READY:${i}:${t}:${bounds.x}:${cropY}:${bounds.w}:${bounds.h}:${screenshotPath}`);
  // Wait for screenshot to be taken by external process
  await wait(4000);

  // Crop screenshot to video area
  const refPath = join(TEMP_DIR, `frame_${i}_ref.png`).replace(/\\/g, "/");
  const cropResult = spawnSync(FFMPEG, [
    "-y", "-i", screenshotPath,
    "-vf", `crop=${bounds.w}:${bounds.h}:${bounds.x}:${cropY}`,
    refPath
  ], { encoding: "utf8" });
  if (cropResult.status === 0) {
    console.log(`frame ${i + 1} cropped to ${refPath}`);
  } else {
    console.log(`crop failed: ${cropResult.stderr?.slice(0, 200)}`);
  }
}

rdp.destroy();
console.log("\nDONE");
