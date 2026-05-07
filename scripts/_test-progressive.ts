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

// First cancel any active download
await rdp.evalInTab(consoleActor,
  `JSON.stringify((() => {
    const grp = document.querySelector('[data-ytdl-download-group]');
    const btn = grp ? grp.querySelector('yt-button-view-model:first-child button') : null;
    const label = btn ? btn.getAttribute('aria-label') : null;
    if (label === 'Cancel download') btn.click();
    return { label };
  })()`
);

await new Promise(r => setTimeout(r, 2000));

// Trigger fetchProgressive directly in MAIN world (max 1 iteration) and store result
await rdp.evalInTab(consoleActor,
  `(function() {
    window.__ytdlTestResult = null;
    window.__ytdlTestError = null;
    window.__ytdlTestStarted = Date.now();
    const sabr = window.__ytdlSabr;
    if (!sabr) { window.__ytdlTestError = 'no sabr obj'; return; }
    sabr.fetchProgressive({ targetDurationMs: 5000, maxIterations: 1, carryState: null })
      .then(r => {
        window.__ytdlTestResult = { audio: r.audioBytes.length, video: r.videoBytes.length, ms: r.audioCoveredMs };
        console.log('[ytdl-test] fetchProgressive done', window.__ytdlTestResult);
      })
      .catch(e => {
        window.__ytdlTestError = String(e);
        console.error('[ytdl-test] fetchProgressive error', e);
      });
  })()`
);

console.log("Triggered fetchProgressive. Waiting 35s for completion...");

// Wait and then check result
for (let i = 0; i < 7; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const check = await rdp.evalInTab(consoleActor,
    `JSON.stringify({ result: window.__ytdlTestResult, error: window.__ytdlTestError, age: Date.now() - (window.__ytdlTestStarted||0) })`
  );
  console.log(`T+${(i+1)*5}s:`, check);
  if (window !== undefined) {
    const parsed = JSON.parse(check);
    if (parsed.result !== null || parsed.error !== null) {
      console.log("Got result!");
      break;
    }
  }
}

rdp.destroy();
