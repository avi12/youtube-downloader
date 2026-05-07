/**
 * Seeks the YouTube player to a given timestamp, scrolls the video into view,
 * and outputs the crop rectangle to use on a full-browser screenshot.
 * Browser chrome height = screenshot height - window.innerHeight.
 * Usage: bun scripts/_seek-ref-frame.ts <seekSec> <screenshotHeightPx>
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const seekTo = parseInt(process.argv[2] ?? "0");
const screenshotH = parseInt(process.argv[3] ?? "1055");

const port = findFirefoxRdpPort();
if (!port) throw new Error("no port");
const rdp = new RDP(port);
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(tab => tab.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no watch tab");
const ca = await rdp.getConsoleActor(ytTab.actor);
if (!ca) throw new Error("no actor");

// Scroll to top so video is visible, then seek and pause
await rdp.evalInTab(ca, `(function() {
  window.scrollTo(0, 0);
  var p = document.querySelector("#movie_player");
  if (p && p.seekTo) p.seekTo(${seekTo}, true);
  setTimeout(function() {
    var v = document.querySelector("#movie_player video") || document.querySelector("video");
    if (v) v.pause();
  }, 2000);
})()`);

await wait(2500);

const infoRaw = await rdp.evalInTab(ca, `(function() {
  var v = document.querySelector("#movie_player video") || document.querySelector("video");
  var innerH = window.innerHeight;
  if (!v) return JSON.stringify({error:"no video", innerH: innerH});
  var r = v.getBoundingClientRect();
  return JSON.stringify({
    innerH: innerH,
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
    currentTime: v.currentTime
  });
})()`);

const info = JSON.parse(typeof infoRaw === "string" ? infoRaw : "{}") as { innerH?: number; x?: number; y?: number; w?: number; h?: number; currentTime?: number; error?: string };
if (info.error) {
  console.log("ERROR:" + info.error);
} else {
  const chromeH = screenshotH - (info.innerH ?? 970);
  const cropX = info.x ?? 0;
  const cropY = chromeH + (info.y ?? 0);
  console.log(`CROP:${cropX}:${cropY}:${info.w}:${info.h}`);
  console.log(`TIME:${info.currentTime?.toFixed(1)}`);
  console.log(`INNER_H:${info.innerH} CHROME_H:${chromeH}`);
}
rdp.destroy();
