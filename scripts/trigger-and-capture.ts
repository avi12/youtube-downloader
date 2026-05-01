// Cancel any in-flight download, install console capture, click download
// fresh, capture all subsequent ytdl: console output.
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

    // Step 1: cancel existing
    const cancel = await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
      const aria = btn?.getAttribute('aria-label') ?? '(no btn)';
      if (aria === 'Cancel download') { btn.click(); return 'cancelled'; }
      return 'idle: ' + aria;
    })()`
    );
    console.log(`step1 cancel: ${cancel}`);

    await new Promise(resolve => setTimeout(resolve, 2_000));

    // Step 2: install interceptor + reset buffer
    await rdp.evalInTab(
      consoleActor, `(() => {
      window.__capBuf = [];
      if (!window.__capInstalled) {
        const wrap = (orig) => function(...args) {
          const s = args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a).slice(0,300); } catch { return String(a); } })()).join(' ');
          if (s.includes('ytdl:') || s.includes('ytdl ') || s.includes('[ytdl')) window.__capBuf.push(Date.now() + ' ' + s);
          if (window.__capBuf.length > 1000) window.__capBuf.shift();
          return orig.apply(console, args);
        };
        const origLog = console.log, origInfo = console.info, origWarn = console.warn, origError = console.error;
        console.log = wrap(origLog);
        console.info = wrap(origInfo);
        console.warn = wrap(origWarn);
        console.error = wrap(origError);
        window.__capInstalled = true;
      }
      return 'cap-ready';
    })()`
    );
    console.log(`step2 capture installed`);

    // Step 3: prime template via brief muted play
    await rdp.evalInTab(consoleActor, `(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => {}); } return 'play'; })()`);
    await new Promise(resolve => setTimeout(resolve, 8_000));
    await rdp.evalInTab(consoleActor, `(() => { document.querySelector('video')?.pause(); return 'pause'; })()`);

    const tplState = await rdp.evalInTab(
      consoleActor, `(() => {
      const t = window.__ytdlSabrTemplate;
      return JSON.stringify({ has: !!t, ageMs: t ? Date.now() - t.capturedAt : -1 });
    })()`
    );
    console.log(`step3 template: ${tplState}`);

    // Step 4: click download
    const click = await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
      const aria = btn?.getAttribute('aria-label') ?? '(no btn)';
      if (aria !== 'Download') return 'aria: ' + aria;
      btn.click();
      return 'clicked';
    })()`
    );
    console.log(`step4 click: ${click}`);

    // Step 5: poll captured messages
    const startTime = Date.now();
    let lastSeen = 0;
    while (Date.now() - startTime < 60_000) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const out = await rdp.evalInTab(consoleActor, `JSON.stringify(window.__capBuf.slice(${lastSeen}))`);
      const lines: string[] = JSON.parse(out);
      lastSeen += lines.length;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (lines.length > 0) {
        console.log(`@${elapsed}s +${lines.length} msgs`);
        for (const line of lines) {
          console.log(`  ${line.slice(0, 240)}`);
        }
      } else {
        console.log(`@${elapsed}s (no new messages)`);
      }
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
