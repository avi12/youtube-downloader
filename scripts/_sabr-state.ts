import { findFirefoxRdpPort, RDP, isFirefoxTab, isRecord } from "./firefox-rdp.js";

const port = findFirefoxRdpPort();
if (!port) { console.error("no RDP port"); process.exit(1); }
const rdp = new RDP(port);
await rdp.connect();

const res = await rdp.request("root", "listTabs");
const tabs = (Array.isArray(res.tabs) ? res.tabs : []).filter(isFirefoxTab);
const yt = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!yt) { console.error("no YT tab"); rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as Record<string, unknown>).consoleActor as string;

const state = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const tmpl = window.__ytdlSabrTemplate;
    const video = document.querySelector('video');
    const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
    return {
      templateAge: tmpl ? Math.round((Date.now() - tmpl.capturedAt) / 1000) : null,
      videoCurrentTime: video ? Math.round(video.currentTime) : null,
      videoPaused: video ? video.paused : null,
      buttonLabel: btn ? btn.getAttribute('aria-label') : null
    };
  })())`
);
console.log("SABR state:", state);
rdp.destroy();
