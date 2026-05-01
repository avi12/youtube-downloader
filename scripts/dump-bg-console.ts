// Resolve the extension process via watcher, then dump its cached console messages.
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

    const targets: Record<string, unknown>[] = [];
    rdp.onEvent = packet => {
      if (packet.type === "target-available-form" && isRecord(packet.target)) {
        targets.push(packet.target);
      }
    };

    await rdp.request(watcherActor, "watchTargets", { targetType: "process" });
    await new Promise(resolve => setTimeout(resolve, 1500));

    const extProc = targets.find(target => target.remoteType === "extension" && typeof target.consoleActor === "string");
    if (!extProc || typeof extProc.consoleActor !== "string") {
      console.log("no extension process");
      return;
    }

    console.log(`extProc consoleActor=${extProc.consoleActor} pid=${extProc.processID}`);

    const cached = await rdp.request(extProc.consoleActor, "getCachedMessages", { messageTypes: ["ConsoleAPI", "PageError"] });
    const list = Array.isArray(cached.messages) ? cached.messages : [];
    console.log(`total cached: ${list.length}`);
    for (const msg of list.slice(-100)) {
      if (!isRecord(msg)) {
        continue;
      }

      const args = Array.isArray(msg.arguments) ? msg.arguments : [];
      const txt = args.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg).slice(0, 150)).join(" ");
      const errStr = typeof msg.errorMessage === "string" ? msg.errorMessage : "";
      const finalTxt = txt || errStr;
      const level = msg.level ?? "?";
      if (finalTxt) {
        console.log(`  [${level}] ${finalTxt.slice(0, 280)}`);
      }
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
