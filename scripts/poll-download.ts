// Single-shot poll: dump button state, scrub iframes, and recent capture entries.
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
    const yt = tabs.filter(isFirefoxTab).find(t => t.url?.includes("watch?v="));
    if (!yt) {
      throw new Error("no yt watch tab");
    }

    const target = await rdp.request(yt.actor, "getTarget");
    const frame = target.frame as Record<string, unknown>;
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
      throw new Error("no actor");
    }

    const consoleActor = frame.consoleActor;

    const state = await rdp.evalInTab(
      consoleActor, `JSON.stringify({
      btn: document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button')?.getAttribute('aria-label') ?? null,
      scrubFrames: document.querySelectorAll('iframe[src*="ytdlScrubMode"]').length,
      captureLen: (window.__ytdlConsoleCapture ?? []).length,
      recent: (window.__ytdlConsoleCapture ?? []).slice(-30)
    })`
    );
    if (state.startsWith("EX:")) {
      console.log(state);
      return;
    }

    const parsed = JSON.parse(state);
    console.log(`btn="${parsed.btn}" scrub=${parsed.scrubFrames} capLen=${parsed.captureLen}`);
    for (const m of parsed.recent ?? []) {
      console.log(`  ${m.slice(0, 280)}`);
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
