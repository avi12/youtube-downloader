// Single-shot poll: dump button state, scrub iframes, and recent capture entries.
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
    const youtubeTab = tabs.find(tab => tab.url?.includes("watch?v="));
    if (!youtubeTab) {
      throw new Error("no yt watch tab");
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      throw new Error("no actor");
    }

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
    for (const message of parsed.recent ?? []) {
      console.log(`  ${message.slice(0, 280)}`);
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
