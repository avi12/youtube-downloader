import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const rdp = new RDP(findFirefoxRdpPort()!);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

// Cancel any active download
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Cancel download') b.click(); return 'ok'; })())`
);
await new Promise(r => setTimeout(r, 2000));

// Install spy for the CORRECT event name used by @webext-core/messaging/page
await rdp.evalInTab(consoleActor,
  `(function() {
    window.__ytdlSpyEvents = [];
    const EVT = '@webext-core/messaging/custom-events';
    window.addEventListener(EVT, e => {
      try {
        const detail = e.detail;
        window.__ytdlSpyEvents.push({
          fired: true,
          detailType: typeof detail,
          detailNull: detail === null,
          detailNamespace: detail?.namespace,
          detailMsgType: detail?.message?.type,
          canReadDetail: !!detail
        });
      } catch(err) {
        window.__ytdlSpyEvents.push({ fired: true, error: String(err) });
      }
    }, true);
    console.log('[spy2] installed listener for', EVT);
  })()`
);

// Trigger download
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Download') { b.click(); return 'clicked'; } return b?.getAttribute('aria-label'); })())`
);

console.log("Download triggered. Waiting 15s for cross-world event...");
await new Promise(r => setTimeout(r, 15_000));

const events = await rdp.evalInTab(consoleActor, `JSON.stringify(window.__ytdlSpyEvents)`);
console.log("Events caught:", events);

// Cancel and cleanup
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Cancel download') b.click(); return 'cancelled'; })())`
);

rdp.destroy();
