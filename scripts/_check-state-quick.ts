import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
const port = findFirefoxRdpPort();
const rdp = new RDP(port!);
await rdp.connect();
const res = await rdp.request("root", "listTabs");
const yt = (res.tabs as {url?:string,actor:string}[]).find(t => t.url?.includes("youtube.com/watch"));
if (!yt) { console.log("no yt tab"); rdp.destroy(); process.exit(0); }
const target = await rdp.request(yt.actor, "getTarget");
const ca = (target.frame as {consoleActor:string}).consoleActor;
await rdp.request(ca, "startListeners", { listeners: ["PageError", "ConsoleAPI"] });
const state = await rdp.evalInTab(ca, `(function() {
  var t = window.__ytdlSabrTemplate;
  var cap = window.__ytdlCapture;
  return JSON.stringify({
    hasTemplate: !!t,
    templateAgeMs: t ? (Date.now() - t.capturedAt) : null,
    templateUrl: t ? t.url.slice(0,100) : null,
    bodyLen: t ? (t.body ? t.body.byteLength || t.body.length : 0) : null,
    hasCapture: !!cap,
    captureActive: cap ? cap.active : null,
    hasSabrInits: !!window.__ytdlSabrInits
  });
})()`);
console.log("State:", state);
rdp.destroy();
