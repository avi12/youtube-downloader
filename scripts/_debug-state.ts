import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

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
    const inits = window.__ytdlSabrInits;
    const sabr = window.__ytdlSabr;
    return {
      hasTemplate: !!tmpl,
      templateAge: tmpl ? Math.round((Date.now() - tmpl.capturedAt) / 1000) : null,
      templateUrl: tmpl ? tmpl.url.slice(0, 60) : null,
      hasInits: { video: !!(inits?.video?.length), audio: !!(inits?.audio?.length) },
      hasSabrObj: !!sabr,
      isTemplatePresent: sabr ? sabr.isTemplatePresent() : false
    };
  })())`
);
console.log("SABR state:", state);

rdp.destroy();
