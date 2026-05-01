// Subscribe to console-message resources, filter to extension process and ytdl logs.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
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

    let extProcessTag: string | null = null;
    rdp.onEvent = packet => {
      if (packet.type === "target-available-form" && isRecord(packet.target)) {
        const target = packet.target;
        if (target.remoteType === "extension" && typeof target.processID === "number") {
          extProcessTag = `process${target.processID}`;
          console.log(`[ext-target] tag=${extProcessTag}`);
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

            const isExtProc = extProcessTag !== null && fromStr.includes(extProcessTag);
            const isYtdl = out.includes("ytdl") || out.includes("FFmpeg") || out.includes("ffmpeg") || out.includes("pipeline") || out.includes("triggerDownload");
            if (isExtProc || isYtdl) {
              console.log(`[${level}] ${out.slice(0, 320)}`);
            }
          }
        }
      }
    };

    await rdp.request(watcherActor, "watchTargets", { targetType: "process" });
    await rdp.request(watcherActor, "watchResources", { resourceTypes: ["console-message", "error-message"] });

    console.log("subscribed; waiting 60s for console messages...");
    await new Promise(resolve => setTimeout(resolve, 60_000));
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
