/**
 * Reloads the YouTube page, waits for the player to be ready, then seeks and pauses.
 * Usage: bun scripts/_reload-and-seek.ts <tSec>
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const tSec = parseInt(process.argv[2] ?? "10");

const port = findFirefoxRdpPort();
if (!port) throw new Error("no port");
const rdp = new RDP(port);
await rdp.connect();

let tabs = await rdp.listTabs();
let ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no yt tab");
let ca = await rdp.getConsoleActor(ytTab.actor);

// Reload the page
await rdp.evalInTab(ca, `location.reload()`);
await wait(6000);

// Re-connect to the tab after reload
tabs = await rdp.listTabs();
ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no yt tab after reload");
ca = await rdp.getConsoleActor(ytTab.actor);

// Wait for player to be ready
let playerReady = false;
for (let i = 0; i < 15; i++) {
  const state = await rdp.evalInTab(ca, `(function() {
    var v = document.querySelector('#movie_player video') || document.querySelector('video');
    if (!v) return 'no-video';
    return 'ready-' + v.readyState;
  })()`);
  console.log("player state:", state);
  if (typeof state === "string" && state.includes("ready-") && !state.endsWith("ready-0")) {
    playerReady = true;
    break;
  }
  await wait(1000);
}

if (!playerReady) {
  console.log("WARN: player may not be ready");
}

// Seek and pause using video element directly (more reliable than seekTo API)
await rdp.evalInTab(ca, `(function() {
  var v = document.querySelector('#movie_player video') || document.querySelector('video');
  if (!v) return;
  v.pause();
  v.currentTime = ${tSec};
})()`);

await wait(3000);

const boundsRaw = await rdp.evalInTab(ca, `(function() {
  var v = document.querySelector('#movie_player video') || document.querySelector('video');
  if (!v) return JSON.stringify({error:"no video"});
  var r = v.getBoundingClientRect();
  return JSON.stringify({
    x: Math.round(r.left), y: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height),
    time: v.currentTime.toFixed(1),
    readyState: v.readyState,
    paused: v.paused
  });
})()`);

console.log("BOUNDS:" + boundsRaw);
rdp.destroy();
