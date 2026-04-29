// Trigger a download and stream ytdl:pipeline + ytdl:ffmpeg-stderr messages live.
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) throw new Error("no port");

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs: unknown[] = (await rdp.request("root", "listTabs")).tabs as unknown[];
    const yt = tabs.filter(isFirefoxTab).find(t => t.url?.includes("youtube.com/watch"));
    if (!yt) throw new Error("no yt tab");

    const target = await rdp.request(yt.actor, "getTarget");
    const frame = (target.frame as Record<string, unknown>);
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") throw new Error("no actor");

    const actor = frame.consoleActor;

    // Subscribe to console messages
    rdp.onEvent = (packet: Record<string, unknown>) => {
      if (packet.type === "consoleAPICall") {
        const call = packet.message as Record<string, unknown>;
        const args = (call?.arguments as Array<Record<string, unknown>>) ?? [];
        const text = args.map(a => a.value ?? a.description ?? "").join(" ");
        const str = String(text);
        if (str.includes("ytdl:pipeline") || str.includes("ytdl:ffmpeg") || str.includes("pipeline-error") || str.includes("concat") || str.includes("mux failed")) {
          const ts = new Date().toISOString().slice(11, 23);
          console.log(`[${ts}] ${str}`);
        }
      }
    };

    await rdp.request(actor, "startListeners", { listeners: ["ConsoleAPI"] });

    // Trigger download
    await rdp.evalInTab(actor, `(() => {
      const btn = document.querySelector('[aria-label="Download"]') || document.querySelector('[aria-label="Download again"]');
      if (btn) { btn.click(); return 'clicked: ' + btn.getAttribute('aria-label'); }
      return 'no button found';
    })()`);
    console.log("Download triggered, watching for pipeline messages...");

    // Wait up to 10 minutes
    await new Promise(r => setTimeout(r, 600_000));
  } finally {
    rdp.destroy();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
