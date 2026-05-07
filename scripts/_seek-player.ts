/**
 * Seeks the YouTube player to the given timestamp and returns video bounds.
 * Usage: bun scripts/_seek-player.ts <tSec>
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const tSec = parseInt(process.argv[2] ?? "0");

const port = findFirefoxRdpPort();
if (!port) throw new Error("no port");
const rdp = new RDP(port);
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no yt tab");
const ca = await rdp.getConsoleActor(ytTab.actor);

await rdp.evalInTab(ca, `(function() {
  var p = document.querySelector('#movie_player');
  if (p && p.seekTo) p.seekTo(${tSec}, true);
  setTimeout(function() {
    var v = document.querySelector('#movie_player video') || document.querySelector('video');
    if (v) v.pause();
  }, 1500);
})()`);

await wait(3000);

const boundsRaw = await rdp.evalInTab(ca, `(function() {
  var v = document.querySelector('#movie_player video') || document.querySelector('video');
  if (!v) return JSON.stringify({error:"no video"});
  var r = v.getBoundingClientRect();
  return JSON.stringify({
    x: Math.round(r.left), y: Math.round(r.top),
    w: Math.round(r.width), h: Math.round(r.height),
    time: v.currentTime.toFixed(1)
  });
})()`);

console.log("BOUNDS:" + boundsRaw);
rdp.destroy();
