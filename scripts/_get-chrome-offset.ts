import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const port = findFirefoxRdpPort();
if (!port) throw new Error("no port");
const rdp = new RDP(port);
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(tab => tab.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no watch tab");
const ca = await rdp.getConsoleActor(ytTab.actor);
if (!ca) throw new Error("no actor");

// Navigate to reload the page
await rdp.evalInTab(ca, "location.reload()");
console.log("RELOADING...");
await wait(5000);

const info = await rdp.evalInTab(ca, `(function() {
  var v = document.querySelector("#movie_player video") || document.querySelector("video");
  return JSON.stringify({
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    outerW: window.outerWidth,
    outerH: window.outerHeight,
    devicePR: window.devicePixelRatio,
    vBounds: v ? (function(r){return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};})(v.getBoundingClientRect()) : null
  });
})()`);
console.log("INFO:" + info);
rdp.destroy();
