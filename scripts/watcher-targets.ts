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

    // Listen for events on the watcher; targetAvailable carries the target form.
    const targets: unknown[] = [];
    rdp.onEvent = packet => {
      if (packet.type === "target-available-form" || (typeof packet.from === "string" && packet.from === watcherActor)) {
        targets.push(packet);
      }
    };

    await rdp.request(watcherActor, "watchTargets", { targetType: "frame" });
    await new Promise(resolve => setTimeout(resolve, 1500));
    await rdp.request(watcherActor, "watchTargets", { targetType: "process" });
    await new Promise(resolve => setTimeout(resolve, 1500));

    console.log(`captured ${targets.length} target events`);
    for (const target of targets) {
      console.log(JSON.stringify(target).slice(0, 400));
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
