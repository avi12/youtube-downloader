import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const port = findFirefoxRdpPort();
if (!port) throw new Error("no port");
const rdp = new RDP(port);
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no yt tab");
const ca = await rdp.getConsoleActor(ytTab.actor);

// Close any open dialog
const closeResult = await rdp.evalInTab(ca, `(function() {
  var btns = document.querySelectorAll("button");
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === "Not now") { btns[i].click(); return "closed dialog"; }
  }
  return "no dialog";
})()`);
console.log(closeResult);
await wait(500);

// Click extension download button
const clickResult = await rdp.evalInTab(ca, `(function() {
  var group = document.querySelector("[data-ytdl-download-group]");
  if (!group) return "extension group not found";
  var btn = group.querySelector(".ytdl-download-button button") || group.querySelector("button");
  if (!btn) return "button not found in group";
  btn.click();
  return "clicked extension download button";
})()`);
console.log(clickResult);

rdp.destroy();
