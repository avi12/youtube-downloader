import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
const port = findFirefoxRdpPort();
const rdp = new RDP(port!);
await rdp.connect();
const res = await rdp.request("root", "listTabs");
const yt = (res.tabs as {url?:string,actor:string}[]).find(t => t.url?.includes("youtube.com/watch"));
const target = await rdp.request(yt!.actor, "getTarget");
const ca = (target.frame as {consoleActor:string}).consoleActor;
await rdp.request(ca, "startListeners", { listeners: ["PageError", "ConsoleAPI"] });

// Check recent console messages
const msgs = await rdp.request(ca, "getCachedMessages", { messageTypes: ["ConsoleAPI"] });
const ytdlMsgs = (msgs.messages || []).filter((m: {arguments?: {value:string}[]}) => {
  const txt = m.arguments?.[0]?.value ?? "";
  return txt.includes("ytdl");
}).slice(-20);
console.log("Recent ytdl msgs:", JSON.stringify(ytdlMsgs.map((m: {arguments?: {value:string}[]}) => m.arguments?.[0]?.value)));

// Check button state
const btn = await rdp.evalInTab(ca, `(function() {
  var grp = document.querySelector('[data-ytdl-download-group]');
  var b = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
  return JSON.stringify({ label: b ? b.getAttribute('aria-label') : null });
})()`);
console.log("Button:", btn);
rdp.destroy();
