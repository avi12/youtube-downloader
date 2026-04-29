// Probe whether CustomEvent-based cross-world messaging from MAIN reaches ISOLATED.
// Dispatches a custom event on MAIN's window and lists what the page-context
// listener captures. Helps diagnose why crossWorldMessenger.sendMessage isn't
// reaching ISOLATED handlers.
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs: unknown[] = (await rdp.request("root", "listTabs")).tabs as unknown[];
    const yt = tabs.filter(isFirefoxTab).find(t => t.url?.includes("youtube.com"));
    if (!yt) {
      throw new Error("no yt tab");
    }

    const target = await rdp.request(yt.actor, "getTarget");
    const frame = (target.frame as Record<string, unknown>);
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
      throw new Error("no actor");
    }

    const actor = frame.consoleActor;

    // List what's in the cross-world messenger namespace and whether ISOLATED registered handlers.
    const probe = await rdp.evalInTab(
      actor, `JSON.stringify({
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
