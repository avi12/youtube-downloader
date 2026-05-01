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

    const errorTab = tabs.find(tab => tab.url?.startsWith("about:neterror"));
    if (errorTab) {
      await rdp.request(errorTab.actor, "navigateTo", { url: "about:downloads" });
      await new Promise(resolve => setTimeout(resolve, 2500));
    }

    const tabsAfter = await rdp.listTabs();
    const downloadsTab = tabsAfter.find(tab => tab.url === "about:downloads");
    if (!downloadsTab) {
      console.log("still no about:downloads tab");
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
        return JSON.stringify(all.slice(-5).map(d => ({
          path: d.target.path,
          state: d.succeeded ? 'succeeded' : (d.canceled ? 'canceled' : (d.error ? 'error' : 'in-progress')),
          totalBytes: d.totalBytes,
          startTime: d.startTime?.toISOString?.() ?? null
        })));
      } catch(e) { return 'err: ' + (e?.message ?? String(e)); }
    })()`
    );
    console.log(result);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
