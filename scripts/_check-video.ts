import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const port = findFirefoxRdpPort();
const rdp = new RDP(port);
await rdp.connect();
const res = await rdp.request("root", "listTabs");
const tabs = (Array.isArray(res.tabs) ? res.tabs : []).filter(isFirefoxTab);
const yt = tabs.find(t => t.url?.includes("youtube.com/watch"));
const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = target.frame.consoleActor;

const r = await rdp.evalInTab(consoleActor, `JSON.stringify({
  videoInTop: !!document.querySelector('video'),
  videoDuration: document.querySelector('video')?.duration,
  videoCurrentTime: document.querySelector('video')?.currentTime,
  iframesCount: document.querySelectorAll('iframe').length
})`);
console.log("Video context:", r);
rdp.destroy();
