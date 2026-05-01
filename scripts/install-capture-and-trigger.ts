// Installs console capture, then clicks download, then dumps captures over time.
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

    await rdp.evalInTab(
      consoleActor, `(() => {
      window.__ytdlConsoleCapture = [];
      const tap = (orig) => function(...args) {
        const s = args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a).slice(0,200) } catch { return String(a); } })()).join(' ');
        window.__ytdlConsoleCapture.push('[' + new Date().toISOString().slice(11,19) + '] ' + s);
        if (window.__ytdlConsoleCapture.length > 500) window.__ytdlConsoleCapture.shift();
        return orig(...args);
      };
      console.log = tap(console.log.bind(console));
      console.info = tap(console.info.bind(console));
      console.warn = tap(console.warn.bind(console));
      console.error = tap(console.error.bind(console));
      return 'installed';
    })()`
    );
    console.log("installed capture");

    // Skip cancel — it's already idle.

    // Click download.
    await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
      btn?.click();
      return btn?.getAttribute('aria-label');
    })()`
    );

    // Poll every 30s for up to 8 minutes.
    for (let iPoll = 0; iPoll < 16; iPoll++) {
      await new Promise(resolve => setTimeout(resolve, 30_000));
      const state = await rdp.evalInTab(
        consoleActor, `JSON.stringify({
        btn: document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button')?.getAttribute('aria-label'),
        scrubFrames: document.querySelectorAll('iframe[src*="ytdlScrubMode"]').length,
        recent: (window.__ytdlConsoleCapture ?? []).filter(s => s.includes('ytdl:scrub-bg') || s.includes('pipeline') || s.includes('ffmpeg') || s.includes('mux') || s.includes('finaliz') || s.includes('triggerDownload')).slice(-15)
      })`
      );
      const parsed = JSON.parse(state);
      console.log(`[poll ${iPoll}] btn="${parsed.btn}" scrub=${parsed.scrubFrames}`);
      for (const message of parsed.recent ?? []) {
        console.log(`  ${message.slice(0, 280)}`);
      }

      if (parsed.btn === "Download" && parsed.scrubFrames === 0 && iPoll > 0) {
        console.log("looks complete");
        break;
      }
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
