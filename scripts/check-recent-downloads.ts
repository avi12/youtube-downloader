// Use Downloads API to read history rather than the visible richlistitem list.
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
    const downloadsTab = tabs.find(tab => tab.url === "about:downloads");
    if (!downloadsTab) {
      console.log("no about:downloads tab");
      return;
    }

    const consoleActor = await rdp.getConsoleActor(downloadsTab.actor);
    if (!consoleActor) {
      throw new Error("no actor");
    }

    const result = await rdp.evalInTab(
      consoleActor, `(async () => {
      try {
        const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        const list = await Downloads.getList(Downloads.ALL);
        const all = await list.getAll();
        return JSON.stringify(all.slice(-10).map(d => ({
          target: d.target.path,
          state: d.succeeded ? 'succeeded' : (d.canceled ? 'canceled' : (d.error ? 'error' : 'progress')),
          totalBytes: d.totalBytes,
          startTime: d.startTime?.toISOString?.() ?? null,
          error: d.error ? String(d.error) : null
        })));
      } catch (e) {
        return 'err: ' + (e?.message ?? String(e));
      }
    })()`
    );
    console.log(`recent: ${result}`);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
