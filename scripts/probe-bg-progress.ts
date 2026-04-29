// Connects to the background page actor and dumps recent console logs,
// to see ffmpeg/pipeline status from the BG side.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  console.log(`connecting to RDP port ${port}`);
  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const addonsResp = await rdp.request("root", "listAddons");
    const addons: unknown[] = Array.isArray(addonsResp.addons) ? addonsResp.addons : [];
    const ytdl = addons.find(a => isRecord(a) && typeof a.name === "string" && a.name.includes("YouTube"));
    if (!isRecord(ytdl) || typeof ytdl.actor !== "string") {
      console.log("no ytdl addon, listing all:", addons.map(a => isRecord(a) ? a.name : "?").join(", "));
      return;
    }

    console.log(`addon: ${ytdl.name} actor=${ytdl.actor}`);
    const target = await rdp.request(ytdl.actor as string, "getTarget");
    if (!isRecord(target)) {
      console.log("no target");
      return;
    }

    const frame = target.form ?? target.frame;
    console.log("target frame keys:", isRecord(frame) ? Object.keys(frame).join(",") : "(none)");

    if (isRecord(frame) && typeof frame.consoleActor === "string") {
      const consoleActor = frame.consoleActor;
      const messages = await rdp.request(consoleActor, "getCachedMessages", { messageTypes: ["ConsoleAPI"] });
      const list = Array.isArray(messages.messages) ? messages.messages : [];
      console.log(`cached messages: ${list.length}`);
      for (const msg of list.slice(-30)) {
        if (!isRecord(msg)) {
          continue;
        }

        const args = Array.isArray(msg.arguments) ? msg.arguments : [];
        const txt = args.map(a => typeof a === "string" ? a : JSON.stringify(a).slice(0, 200)).join(" ");
        if (txt.includes("ytdl") || txt.includes("ffmpeg") || txt.includes("pipeline")) {
          console.log(`  [${msg.level}] ${txt.slice(0, 250)}`);
        }
      }
    }
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
