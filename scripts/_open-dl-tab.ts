import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) throw new Error("no port");

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs: unknown[] = (await rdp.request("root", "listTabs")).tabs as unknown[];
    const firefoxTabs = tabs.filter(isFirefoxTab);

    const errorTab = firefoxTabs.find(t => t.url?.startsWith("about:neterror"));
    if (errorTab) {
      await rdp.request(errorTab.actor, "navigateTo", { url: "about:downloads" });
      await new Promise(r => setTimeout(r, 2500));
    }

    const tabs2: unknown[] = (await rdp.request("root", "listTabs")).tabs as unknown[];
    const dlTab = tabs2.filter(isFirefoxTab).find(t => t.url === "about:downloads");
    if (!dlTab) {
      console.log("still no about:downloads tab");
      return;
    }

    const target = await rdp.request(dlTab.actor, "getTarget");
    const frame = target.frame as Record<string, unknown>;
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
      throw new Error("no actor");
    }

    const result = await rdp.evalInTab(frame.consoleActor, `(async () => {
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
    })()`);
    console.log(result);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
