// Probe whether CustomEvent-based cross-world messaging from MAIN reaches ISOLATED.
// Dispatches a custom event on MAIN's window and lists what the page-context
// listener captures. Helps diagnose why crossWorldMessenger.sendMessage isn't
// reaching ISOLATED handlers.
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs = await rdp.listTabs();
    const youtubeTab = tabs.find(tab => tab.url?.includes("youtube.com"));
    if (!youtubeTab) {
      throw new Error("no yt tab");
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      throw new Error("no actor");
    }

    // List what's in the cross-world messenger namespace and whether ISOLATED registered handlers.
    const probe = await rdp.evalInTab(
      consoleActor, `JSON.stringify({
      mainWindowKeys: Object.keys(window).filter(k => k.includes('ytdl')).slice(0, 30),
      hasCrossWorldEventListener: (() => {
        // Try emitting a test custom event and see if anyone listens
        try {
          const ev = new CustomEvent('ytdl-test-probe', { detail: 'hello' });
          window.dispatchEvent(ev);
          return 'dispatched';
        } catch (e) { return 'err: ' + e.message; }
      })(),
      hasYtdlSabr: !!window.__ytdlSabr,
      hasCapture: !!window.__ytdlCapture
    })`
    );
    console.log(`probe: ${probe.slice(0, 500)}`);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
