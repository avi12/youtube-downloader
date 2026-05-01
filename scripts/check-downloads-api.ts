// Read Firefox Downloads.sys.mjs from the YouTube tab — it's a privileged
// module accessible from any chrome context, but content tabs can ChromeUtils.import.
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
      console.log("no yt tab");
      return;
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      return;
    }

    const out = await rdp.evalInTab(
      consoleActor, `(async () => {
      try {
        const { Downloads } = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        const list = await Downloads.getList(Downloads.ALL);
        const all = await list.getAll();
        return JSON.stringify(all.slice(-5).map(d => ({
          target: d.target.path,
          state: d.succeeded ? 'succeeded' : (d.canceled ? 'canceled' : 'progress'),
          totalBytes: d.totalBytes
        })));
      } catch (e) { return 'err: ' + (e?.message ?? e); }
    })()`
    );
    console.log(out);
  } finally {
    rdp.destroy();
  }
}
main().catch(err => {
  console.error(err); process.exit(1);
});
