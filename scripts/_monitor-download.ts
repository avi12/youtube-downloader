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
const frame = target.frame;
const consoleActor = (frame as Record<string, unknown>).consoleActor as string;

// Start listening to console messages
await rdp.request(consoleActor, "startListeners", { listeners: ["PageError", "ConsoleAPI"] });

// Click the download button
const clickResult = await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const grp = document.querySelector('[data-ytdl-download-group]');
    const btn = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
    const label = btn ? btn.getAttribute('aria-label') : null;
    if (label === 'Download') { btn.click(); return { clicked: true, label }; }
    return { clicked: false, label };
  })())`
);
console.log("Click:", clickResult);

// Poll button state and check network every 10s for 5 minutes
const start = Date.now();
let prevLabel = "";
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 10_000));
  const elapsed = Math.round((Date.now() - start) / 1000);

  const btnState = await rdp.evalInTab(consoleActor,
    `JSON.stringify((() => {
      const grp = document.querySelector('[data-ytdl-download-group]');
      const btn = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
      return btn ? btn.getAttribute('aria-label') : null;
    })())`
  );

  const sabrActivity = await rdp.evalInTab(consoleActor,
    `JSON.stringify((() => {
      const tmpl = window.__ytdlSabrTemplate;
      const sabr = window.__ytdlSabr;
      return {
        hasTemplate: !!tmpl,
        templateAge: tmpl ? Math.round((Date.now() - tmpl.capturedAt) / 1000) : null,
        hasSabr: !!sabr
      };
    })())`
  );

  const label = JSON.parse(btnState);
  if (label !== prevLabel) {
    console.log(`T+${elapsed}s: label changed to "${label}"`);
    prevLabel = label;
  } else {
    console.log(`T+${elapsed}s: label="${label}" sabr=${sabrActivity}`);
  }

  if (label !== "Cancel download" && label !== "Download") {
    console.log("Done or errored:", label);
    break;
  }
}

rdp.destroy();
