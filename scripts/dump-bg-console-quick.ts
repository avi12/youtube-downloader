// Read BG console via watcher API.
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

    const watcher = watcherResp.actor;

    const seen: string[] = [];
    rdp.onEvent = packet => {
      if (packet.type === "resources-available-array" && Array.isArray(packet.array)) {
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
            const txt = args.map(arg => typeof arg === "string" ? arg : "").join(" ");
            const err = typeof res.errorMessage === "string" ? res.errorMessage : "";
            const out = txt || err;
            if (out && (out.includes("ytdl") || out.includes("script-injection") || out.includes("scrub"))) {
              seen.push(`[${res.level ?? "?"}] ${out.slice(0, 320)}`);
            }
          }
        }
      }
    };

    await rdp.request(watcher, "watchTargets", { targetType: "process" });
    await rdp.request(watcher, "watchResources", { resourceTypes: ["console-message", "error-message"] });
    await new Promise(resolve => setTimeout(resolve, 30_000));
    console.log(`captured ${seen.length} ytdl/scrub messages:`);
    for (const line of seen.slice(-50)) {
      console.log(line);
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
