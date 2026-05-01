// Drives a Firefox tab via the Remote Debugging Protocol (RDP) to verify a
// subscription-derived watch-page download produces a complete file. Workaround
// for when firefox-devtools MCP isn't available — uses `web-ext run`'s built-in
// RDP socket directly.
//
// Usage:
//   1. Start Firefox via `pnpm dev:stable-firefox` (RDP enabled automatically).
//   2. Run: bun scripts/verify-subscription-download.ts
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";

const POLL_INTERVAL_MS = 5_000;
const COMPLETION_TIMEOUT_MS = 600_000;
const NAV_DELAY_MS = 12_000;

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function findYouTubeTab(rdp: RDP) {
  const tabs = await rdp.listTabs();
  const youtubeTab = tabs.find(tab => tab.url?.includes("youtube.com")) ?? tabs[0];
  if (!youtubeTab) {
    throw new Error("no tabs in Firefox; open one and retry");
  }

  const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
  if (!consoleActor) {
    throw new Error("could not get console actor for tab");
  }

  return {
    tabActor: youtubeTab.actor,
    consoleActor,
    url: youtubeTab.url
  };
}

async function navigateTab(rdp: RDP, consoleActor: string, url: string) {
  await rdp.evalInTab(consoleActor, `location.href = ${JSON.stringify(url)}; "navigating"`);
  await wait(NAV_DELAY_MS);
}

const PICK_WATCH_URL_EXPRESSION = `JSON.stringify((() => {
  const tiles = document.querySelectorAll('ytd-rich-item-renderer');
  for (const tile of tiles) {
    const link = tile.querySelector('a[href^="/watch?"]')?.getAttribute('href') ?? '';
    const badge = tile.querySelector('badge-shape, .ytThumbnailBadgeViewModelBadgeText, .badge-shape-wiz__text');
    const durationText = (badge?.textContent ?? '').trim();
    if (!durationText) continue;
    const parts = durationText.split(':').map(n => parseInt(n, 10));
    if (parts.some(Number.isNaN)) continue;
    let totalSec = 0;
    for (const p of parts) totalSec = totalSec * 60 + p;
    if (totalSec < 600 || totalSec > 1800) continue;
    return { link: 'https://www.youtube.com' + link.split('&')[0], durationText, totalSec };
  }
  return { ok: false };
})())`;

const PRIME_TEMPLATE_EXPRESSION = `(async () => {
  const v = document.querySelector('video');
  if (!v) return JSON.stringify({ ok: false, reason: 'no-video' });
  v.muted = true;
  try { await v.play(); } catch (_) {}
  await new Promise(r => setTimeout(r, 8000));
  v.pause();
  const tpl = window.__ytdlSabrTemplate;
  return JSON.stringify({
    ok: true,
    hasTemplate: !!tpl,
    ageMs: tpl ? Date.now() - tpl.capturedAt : -1
  });
})()`;

const CLICK_DOWNLOAD_EXPRESSION = `JSON.stringify((() => {
  const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
  if (!btn) return { ok: false, reason: 'no-button' };
  const aria = btn.getAttribute('aria-label') ?? '';
  if (aria !== 'Download') return { ok: false, reason: 'aria-mismatch', aria };
  btn.click();
  return { ok: true, beforeAria: aria };
})())`;

const READ_PROGRESS_EXPRESSION = `(() => {
  const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
  return btn?.getAttribute('aria-label') ?? '';
})()`;

const READ_DOWNLOADS_EXPRESSION = `JSON.stringify((() => {
  const items = document.querySelectorAll('richlistitem.download');
  return Array.from(items).slice(0, 5).map(item => ({
    name: item.querySelector('.downloadTarget')?.getAttribute('value') ?? '',
    state: item.getAttribute('state') ?? ''
  }));
})())`;

interface PickedVideo {
  link?: string;
  durationText?: string;
  totalSec?: number;
}

function isPickedVideo(value: unknown): value is PickedVideo {
  return typeof value === "object" && value !== null;
}

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("could not discover Firefox RDP port");
  }

  console.log(`[verify] connecting to Firefox RDP on port ${port}`);
  const rdp = new RDP(port);
  await rdp.connect();

  try {
    const tab = await findYouTubeTab(rdp);
    console.log(`[verify] tab url=${tab.url}`);

    if (!tab.url?.includes("/feed/subscriptions")) {
      await navigateTab(rdp, tab.consoleActor, "https://www.youtube.com/feed/subscriptions");
    }

    const pickJson = await rdp.evalInTab(tab.consoleActor, PICK_WATCH_URL_EXPRESSION);
    console.log(`[verify] picked: ${pickJson.slice(0, 200)}`);
    const parsedPick: unknown = JSON.parse(pickJson);
    if (!isPickedVideo(parsedPick) || !parsedPick.link) {
      throw new Error("no 10-30 min video found on subscriptions page");
    }

    console.log(`[verify] navigating to watch: ${parsedPick.link} (${parsedPick.durationText})`);
    await navigateTab(rdp, tab.consoleActor, parsedPick.link);
    // Re-attach to fresh consoleActor after navigation
    const fresh = await findYouTubeTab(rdp);

    const primeJson = await rdp.evalInTab(fresh.consoleActor, PRIME_TEMPLATE_EXPRESSION);
    console.log(`[verify] template prime: ${primeJson.slice(0, 200)}`);

    const clickJson = await rdp.evalInTab(fresh.consoleActor, CLICK_DOWNLOAD_EXPRESSION);
    console.log(`[verify] click result: ${clickJson.slice(0, 200)}`);

    const startTime = Date.now();
    while (Date.now() - startTime < COMPLETION_TIMEOUT_MS) {
      const aria = await rdp.evalInTab(fresh.consoleActor, READ_PROGRESS_EXPRESSION);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[verify] @${elapsed}s aria=${aria}`);

      if (/Downloaded|Download again/.test(aria)) {
        console.log("[verify] button reports DONE; checking about:downloads");
        await navigateTab(rdp, fresh.consoleActor, "about:downloads");
        const downloadsTab = await findYouTubeTab(rdp);
        const downloadsJson = await rdp.evalInTab(downloadsTab.consoleActor, READ_DOWNLOADS_EXPRESSION);
        console.log(`[verify] downloads: ${downloadsJson}`);
        return;
      }

      await wait(POLL_INTERVAL_MS);
    }
    console.log("[verify] FAILED: timeout reached");
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
