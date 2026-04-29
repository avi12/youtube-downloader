// Trigger download + watch BG console + page console concurrently.
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
    const yt = tabs.filter(isFirefoxTab).find(t => t.url?.includes("watch?v="));
    if (!yt) {
      throw new Error("no yt watch tab");
    }

    const target = await rdp.request(yt.actor, "getTarget");
    const frame = target.frame as Record<string, unknown>;
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
      throw new Error("no actor");
    }

    const consoleActor = frame.consoleActor;

    // Set up BG watcher.
    const addons: unknown[] = (await rdp.request("root", "listAddons")).addons as unknown[];
    const ytdl = addons.find(a => isRecord(a) && typeof a.name === "string" && a.name.includes("YouTube"));
    if (!isRecord(ytdl) || typeof ytdl.actor !== "string") {
      throw new Error("no addon");
    }

    const watcherResp = await rdp.request(ytdl.actor as string, "getWatcher");
    const watcherActor = watcherResp.actor as string;

    let extTag: string | null = null;
    rdp.onEvent = packet => {
      if (packet.type === "target-available-form" && isRecord(packet.target)) {
        const t = packet.target;
        if (t.remoteType === "extension" && typeof t.processID === "number") {
          extTag = `process${t.processID}`;
          console.log(`[ext-target] ${extTag}`);
        }
      }

      if (packet.type === "resources-available-array" && Array.isArray(packet.array)) {
        const fromStr = typeof packet.from === "string" ? packet.from : "";
        for (const item of packet.array) {
          if (!Array.isArray(item) || item.length < 2) {
            continue;
          }

          const [, resources] = item;
          if (!Array.isArray(resources)) {
            continue;
          }

          for (const res of resources) {
            if (!isRecord(res)) {
              continue;
            }

            const args = Array.isArray(res.arguments) ? res.arguments : [];
            const txt = args.map(a => typeof a === "string" ? a : JSON.stringify(a).slice(0, 200)).join(" ");
            const err = typeof res.errorMessage === "string" ? res.errorMessage : "";
            const level = res.level ?? res.type ?? "?";
            const out = txt || err;
            if (!out) {
              continue;
            }

            const isExtProc = extTag !== null && fromStr.includes(extTag);
            const isYtdl = /ytdl|FFmpeg|ffmpeg|pipeline|triggerDownload|sourcebuffer-capture|cross-world|isolated/i.test(out);
            if (isExtProc || isYtdl) {
              console.log(`[${level}] ${out.slice(0, 360)}`);
            }
          }
        }
      }
    };

    await rdp.request(watcherActor, "watchTargets", { targetType: "process" });
    await rdp.request(watcherActor, "watchResources", { resourceTypes: ["console-message", "error-message"] });

    console.log("watcher attached; clicking download...");
    await rdp.evalInTab(
      consoleActor, `(() => {
      const btn = document.querySelector('[data-ytdl-download-group] yt-button-view-model:first-child button');
      btn?.click();
      return btn?.getAttribute('aria-label');
    })()`
    );

    // Watch for ~7 minutes.
    await new Promise(r => setTimeout(r, 420_000));
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
