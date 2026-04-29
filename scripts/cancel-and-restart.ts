// Cancel any in-flight download then re-trigger.
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no RDP port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabsResponse = await rdp.request("root", "listTabs");
    const tabs: unknown[] = Array.isArray(tabsResponse.tabs) ? tabsResponse.tabs : [];
    const youtubeTab = tabs.filter(isFirefoxTab).find(tab => tab.url?.includes("youtube.com"));
    if (!youtubeTab) {
      throw new Error("no YouTube tab");
    }

    const targetResponse = await rdp.request(youtubeTab.actor, "getTarget");
    const frame = targetResponse.frame;
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
      throw new Error("no console actor");
    }

    const cancel = await rdp.evalInTab(
      frame.consoleActor, `(() => {
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

    await new Promise(r => setTimeout(r, 3_000));

    const v = await rdp.evalInTab(
      frame.consoleActor, `(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        v.play().catch(() => {});
      }
      return 'play attempt: paused=' + v?.paused;
    })()`
    );
    console.log(v);

    await new Promise(r => setTimeout(r, 10_000));

    const tpl = await rdp.evalInTab(
      frame.consoleActor, `(() => {
      const v = document.querySelector('video');
      v?.pause();
      const t = window.__ytdlSabrTemplate;
      return JSON.stringify({ hasTemplate: !!t, ageMs: t ? Date.now() - t.capturedAt : -1 });
    })()`
    );
    console.log(`template: ${tpl}`);

    const click = await rdp.evalInTab(
      frame.consoleActor, `(() => {
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
