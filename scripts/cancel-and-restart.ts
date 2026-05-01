// Cancel any in-flight download then re-trigger.
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no RDP port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs = await rdp.listTabs();
    const youtubeTab = tabs.find(tab => tab.url?.includes("youtube.com"));
    if (!youtubeTab) {
      throw new Error("no YouTube tab");
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      throw new Error("no console actor");
    }

    const cancel = await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
      const aria = btn?.getAttribute('aria-label') ?? '(no btn)';
      if (aria === 'Cancel download') {
        btn.click();
        return 'cancelled: ' + aria;
      }
      return 'noop: ' + aria;
    })()`
    );
    console.log(cancel);

    await new Promise(resolve => setTimeout(resolve, 3_000));

    const playState = await rdp.evalInTab(
      consoleActor, `(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        v.play().catch(() => {});
      }
      return 'play attempt: paused=' + v?.paused;
    })()`
    );
    console.log(playState);

    await new Promise(resolve => setTimeout(resolve, 10_000));

    const tpl = await rdp.evalInTab(
      consoleActor, `(() => {
      const v = document.querySelector('video');
      v?.pause();
      const t = window.__ytdlSabrTemplate;
      return JSON.stringify({ hasTemplate: !!t, ageMs: t ? Date.now() - t.capturedAt : -1 });
    })()`
    );
    console.log(`template: ${tpl}`);

    const click = await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
      const aria = btn?.getAttribute('aria-label') ?? '(no btn)';
      if (aria !== 'Download') return 'aria: ' + aria;
      btn.click();
      return 'clicked, was: ' + aria;
    })()`
    );
    console.log(`click: ${click}`);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
