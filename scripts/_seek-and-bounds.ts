import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const seekTo = parseInt(process.argv[2] ?? "0");

const port = findFirefoxRdpPort();
if (!port) throw new Error("no port");
const rdp = new RDP(port);
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(tab => tab.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no watch tab");
const ca = await rdp.getConsoleActor(ytTab.actor);
if (!ca) throw new Error("no actor");

const boundsRaw = await rdp.evalInTab(ca, `(function() {
  var v = document.querySelector("#movie_player video") || document.querySelector("video");
  if (!v) return "null";
  var r = v.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});
})()`);
console.log("BOUNDS:" + boundsRaw);

await rdp.evalInTab(ca, `(function() {
  var p = document.querySelector("#movie_player");
  if (p && p.seekTo) p.seekTo(${seekTo}, true);
  setTimeout(function() {
    var v = document.querySelector("#movie_player video") || document.querySelector("video");
    if (v) v.pause();
  }, 2000);
})()`);
console.log("SEEKED:" + seekTo);
await wait(2500);
rdp.destroy();
