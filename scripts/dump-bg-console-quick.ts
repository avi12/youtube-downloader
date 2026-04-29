// Read BG console via watcher API.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) throw new Error("no port");
  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const addons: unknown[] = (await rdp.request("root", "listAddons")).addons as unknown[];
    const ytdl = addons.find(a => isRecord(a) && typeof a.name === "string" && a.name.includes("YouTube"));
    if (!isRecord(ytdl) || typeof ytdl.actor !== "string") throw new Error("no addon");
    const watcher = (await rdp.request(ytdl.actor as string, "getWatcher")).actor as string;

    const seen: string[] = [];
    rdp.onEvent = packet => {
      if (packet.type === "resources-available-array" && Array.isArray(packet.array)) {
        for (const item of packet.array) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const [, resources] = item;
          if (!Array.isArray(resources)) continue;
          for (const res of resources) {
            if (!isRecord(res)) continue;
            const args = Array.isArray(res.arguments) ? res.arguments : [];
            const txt = args.map(a => typeof a === "string" ? a : "").join(" ");
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
    await new Promise(r => setTimeout(r, 30_000));
    console.log(`captured ${seen.length} ytdl/scrub messages:`);
    for (const line of seen.slice(-50)) console.log(line);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
