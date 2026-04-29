// Read Firefox Downloads.sys.mjs from the YouTube tab — it's a privileged
// module accessible from any chrome context, but content tabs can ChromeUtils.import.
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) throw new Error("no port");
  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs: unknown[] = (await rdp.request("root", "listTabs")).tabs as unknown[];
    const yt = tabs.filter(isFirefoxTab).find(t => t.url?.includes("watch?v="));
    if (!yt) {
      console.log("no yt tab");
      return;
    }
    const target = await rdp.request(yt.actor, "getTarget");
    const frame = target.frame as Record<string, unknown>;
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") return;
    const out = await rdp.evalInTab(frame.consoleActor, `(async () => {
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
    })()`);
    console.log(out);
  } finally { rdp.destroy(); }
}
main().catch(err => { console.error(err); process.exit(1); });
