import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
const port = findFirefoxRdpPort();
const rdp = new RDP(port!);
await rdp.connect();
const res = await rdp.request("root", "listTabs");
const yt = (res.tabs as {url?:string,actor:string}[]).find(t => t.url?.includes("youtube.com/watch"));
const target = await rdp.request(yt!.actor, "getTarget");
const ca = (target.frame as {consoleActor:string}).consoleActor;
await rdp.request(ca, "startListeners", { listeners: ["ConsoleAPI"] });
const state = await rdp.evalInTab(ca, `(function() {
  var t = window.__ytdlSabrTemplate;
  var btn = document.querySelector('[data-ytdl-download-group]');
  var b = btn ? btn.querySelector('yt-button-view-model:first-child button') : null;
  return JSON.stringify({
    btnLabel: b ? b.getAttribute('aria-label') : 'not found',
    hasTemplate: !!t,
    templateAge: t ? (Date.now() - t.capturedAt) : null,
    bodyLen: t ? (t.body ? t.body.byteLength || t.body.length : 0) : null
  });
})()`);
console.log("State:", state);
rdp.destroy();
