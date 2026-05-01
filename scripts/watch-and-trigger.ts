// Trigger download + watch BG console + page console concurrently.
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
    const youtubeTab = tabs.find(tab => tab.url?.includes("watch?v="));
    if (!youtubeTab) {
      throw new Error("no yt watch tab");
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      throw new Error("no actor");
    }

    // Set up BG watcher.
    const addonsResp = await rdp.request("root", "listAddons");
    const addons = Array.isArray(addonsResp.addons) ? addonsResp.addons : [];
    const ytdl = addons.find(addon => isRecord(addon) && typeof addon.name === "string" && addon.name.includes("YouTube"));
    if (!isRecord(ytdl) || typeof ytdl.actor !== "string") {
      throw new Error("no addon");
    }

    const watcherResp = await rdp.request(ytdl.actor, "getWatcher");
    if (typeof watcherResp.actor !== "string") {
      throw new Error("no watcher actor");
    }

    const watcherActor = watcherResp.actor;

    let extTag: string | null = null;
    rdp.onEvent = packet => {
      if (packet.type === "target-available-form" && isRecord(packet.target)) {
        const target = packet.target;
        if (target.remoteType === "extension" && typeof target.processID === "number") {
          extTag = `process${target.processID}`;
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
            const txt = args.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg).slice(0, 200)).join(" ");
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
    await new Promise(resolve => setTimeout(resolve, 420_000));
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
