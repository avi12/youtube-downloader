// Probe whether the console.log interceptor is capturing user-tab logs.
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

    // Install interceptor
    await rdp.evalInTab(
      frame.consoleActor, `(() => {
      window.__probeBuffer = [];
      const orig = console.log;
      console.log = function(...args) {
        const s = args.map(a => typeof a === 'string' ? a : JSON.stringify(a).slice(0,300)).join(' ');
        window.__probeBuffer.push(s);
        if (window.__probeBuffer.length > 500) window.__probeBuffer.shift();
        return orig.apply(console, args);
      };
      // Test the wrapper
      console.log('[probe] interceptor installed');
      return 'ok';
    })()`
    );

    // Wait
    await new Promise(r => setTimeout(r, 10_000));

    const out = await rdp.evalInTab(frame.consoleActor, `JSON.stringify(window.__probeBuffer)`);
    const lines: string[] = JSON.parse(out);
    console.log(`captured ${lines.length} console.log calls in 10s window:`);
    for (const line of lines) {
      console.log(`  ${line.slice(0, 240)}`);
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
