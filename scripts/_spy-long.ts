import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const rdp = new RDP(findFirefoxRdpPort()!);
await rdp.connect();

const tabs = ((await rdp.request("root", "listTabs")).tabs as any[]).filter(t => typeof t?.actor === "string");
const yt = tabs.find((t: any) => t.url?.includes("youtube.com/watch"));
if (!yt) { rdp.destroy(); process.exit(1); }

const target = await rdp.request(yt.actor, "getTarget");
const consoleActor = (target.frame as any).consoleActor as string;

// Cancel active download
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Cancel download') b.click(); return 'ok'; })())`
);
await new Promise(r => setTimeout(r, 2000));

// Install spy
await rdp.evalInTab(consoleActor,
  `(function() {
    window.__ytdlSpyEvents = [];
    window.addEventListener('@webext-core/messaging/custom-events', e => {
      const detail = e.detail;
      window.__ytdlSpyEvents.push({
        ns: detail?.namespace,
        type: detail?.message?.type,
        readable: !!detail
      });
    }, true);
  })()`
);

// Trigger download
await rdp.evalInTab(consoleActor,
  `(function() { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Download') b.click(); })()`
);

console.log("Download triggered. Monitoring for up to 3.5 minutes...");

// Poll every 15s for 3.5 minutes
const start = Date.now();
for (let i = 0; i < 14; i++) {
  await new Promise(r => setTimeout(r, 15_000));
  const elapsed = Math.round((Date.now() - start) / 1000);
  
  const events = JSON.parse(await rdp.evalInTab(consoleActor, `JSON.stringify(window.__ytdlSpyEvents)`));
  const btn = await rdp.evalInTab(consoleActor,
    `JSON.stringify((() => { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); return b?.getAttribute('aria-label'); })())`
  );
  
  const hasRunProgressive = events.some((e: any) => e.type?.includes('Progressive') || e.type?.includes('progressive') || e.type === 'RunProgressiveSabr');
  console.log(`T+${elapsed}s: events=${events.length} btn=${btn} hasRunProgressive=${hasRunProgressive}`);
  console.log("  Types:", events.slice(-5).map((e: any) => e.type).join(', '));
  
  if (hasRunProgressive) {
    console.log("RunProgressiveSabr event FOUND:", events.find((e: any) => e.type?.includes('rogressive')));
    break;
  }
}

// Cancel
await rdp.evalInTab(consoleActor,
  `(function() { const g=document.querySelector('[data-ytdl-download-group]'); const b=g?.querySelector('yt-button-view-model:first-child button'); if (b?.getAttribute('aria-label')==='Cancel download') b.click(); })()`
);

rdp.destroy();
