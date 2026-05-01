// Trigger a download and stream ytdl:pipeline + ytdl:ffmpeg-stderr messages live.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs = await rdp.listTabs();
    const youtubeTab = tabs.find(tab => tab.url?.includes("youtube.com/watch"));
    if (!youtubeTab) {
      throw new Error("no yt tab");
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      throw new Error("no actor");
    }

    // Subscribe to console messages
    rdp.onEvent = (packet: Record<string, unknown>) => {
      if (packet.type === "consoleAPICall") {
        if (!isRecord(packet.message)) {
          return;
        }

        const call = packet.message;
        const args = Array.isArray(call.arguments) ? call.arguments : [];
        const text = args.map(arg => isRecord(arg) ? (arg.value ?? arg.description ?? "") : "").join(" ");
        const str = String(text);
        if (str.includes("ytdl:pipeline") || str.includes("ytdl:ffmpeg") || str.includes("pipeline-error") || str.includes("concat") || str.includes("mux failed")) {
          const timestamp = new Date().toISOString().slice(11, 23);
          console.log(`[${timestamp}] ${str}`);
        }
      }
    };

    await rdp.request(consoleActor, "startListeners", { listeners: ["ConsoleAPI"] });

    // Trigger download
    await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[aria-label="Download"]') || document.querySelector('[aria-label="Download again"]');
      if (btn) { btn.click(); return 'clicked: ' + btn.getAttribute('aria-label'); }
      return 'no button found';
    })()`
    );
    console.log("Download triggered, watching for pipeline messages...");

    // Wait up to 10 minutes
    await new Promise(resolve => setTimeout(resolve, 600_000));
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
