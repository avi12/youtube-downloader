// Quick diagnostic — connects to running Firefox via RDP, polls page state +
// recent console messages so we can see scrub-bg segment progression without
// needing the firefox-devtools MCP.
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("could not discover Firefox RDP port");
  }

  console.log(`connecting to RDP port ${port}`);
  const rdp = new RDP(port);
  await rdp.connect();

  try {
    const tabs = await rdp.listTabs();
    console.log(`tabs: ${tabs.length}`);
    for (const tab of tabs) {
      console.log(`- url=${tab.url ?? "(no url)"}`);
    }

    const youtubeTab = tabs.find(tab => tab.url?.includes("youtube.com"));
    if (!youtubeTab) {
      throw new Error("no YouTube tab");
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      throw new Error("could not get console actor");
    }

    const buttonAria = await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
      return btn?.getAttribute('aria-label') ?? '(no btn)';
    })()`
    );
    console.log(`button aria: ${buttonAria}`);

    const iframeCount = await rdp.evalInTab(consoleActor, `(() => document.querySelectorAll('iframe').length)()`);
    console.log(`iframes in tab: ${iframeCount}`);

    const scrubIframeCount = await rdp.evalInTab(consoleActor, `(() => document.querySelectorAll('iframe[src*="ytdlScrubMode"]').length)()`);
    console.log(`scrub iframes: ${scrubIframeCount}`);

    // Install a one-shot console.log capture, wait briefly, then read what was captured.
    await rdp.evalInTab(
      consoleActor, `(() => {
      if (!window.__ytdlConsoleCapture) {
        window.__ytdlConsoleCapture = [];
        const origLog = console.log.bind(console);
        const origInfo = console.info.bind(console);
        console.log = function(...args) {
          const s = args.map(a => typeof a === 'string' ? a : JSON.stringify(a).slice(0,200)).join(' ');
          if (s.includes('ytdl:')) window.__ytdlConsoleCapture.push(s);
          if (window.__ytdlConsoleCapture.length > 200) window.__ytdlConsoleCapture.shift();
          return origLog(...args);
        };
        console.info = function(...args) {
          const s = args.map(a => typeof a === 'string' ? a : JSON.stringify(a).slice(0,200)).join(' ');
          if (s.includes('ytdl:')) window.__ytdlConsoleCapture.push(s);
          if (window.__ytdlConsoleCapture.length > 200) window.__ytdlConsoleCapture.shift();
          return origInfo(...args);
        };
      }
      return 'installed';
    })()`
    );

    await new Promise(resolve => setTimeout(resolve, 25_000));

    const recent = await rdp.evalInTab(consoleActor, `JSON.stringify((window.__ytdlConsoleCapture ?? []).slice(-40))`);
    const lines: string[] = JSON.parse(recent);
    console.log(`recent ytdl: ${lines.length} messages`);
    for (const line of lines) {
      console.log(`  ${line.slice(0, 240)}`);
    }

    const probe = await rdp.evalInTab(
      consoleActor, `JSON.stringify({
      hasYtdlSabr: typeof window.__ytdlSabr !== 'undefined',
      hasCapture: typeof window.__ytdlCapture !== 'undefined',
      hasTemplate: !!window.__ytdlSabrTemplate,
      iframeSrcs: Array.from(document.querySelectorAll('iframe')).map(i => i.src.slice(0, 100))
    })`
    );
    console.log(`page state: ${probe}`);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
