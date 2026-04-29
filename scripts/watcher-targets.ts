import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const addons: unknown[] = (await rdp.request("root", "listAddons")).addons as unknown[];
    const ytdl = addons.find(a => isRecord(a) && typeof a.name === "string" && a.name.includes("YouTube"));
    if (!isRecord(ytdl) || typeof ytdl.actor !== "string") {
      throw new Error("no addon");
    }

    const watcherResp = await rdp.request(ytdl.actor as string, "getWatcher");
    const watcherActor = watcherResp.actor as string;

    // Listen for events on the watcher; targetAvailable carries the target form.
    const targets: unknown[] = [];
    rdp.onEvent = packet => {
      if (packet.type === "target-available-form" || (typeof packet.from === "string" && packet.from === watcherActor)) {
        targets.push(packet);
      }
    };

    await rdp.request(watcherActor, "watchTargets", { targetType: "frame" });
    await new Promise(r => setTimeout(r, 1500));
    await rdp.request(watcherActor, "watchTargets", { targetType: "process" });
    await new Promise(r => setTimeout(r, 1500));

    console.log(`captured ${targets.length} target events`);
    for (const t of targets) {
      console.log(JSON.stringify(t).slice(0, 400));
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
