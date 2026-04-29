// Dumps cached console messages from the YouTube tab's console actor.
import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  console.log(`connecting to RDP port ${port}`);
  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs: unknown[] = (await rdp.request("root", "listTabs")).tabs as unknown[];
    const yt = tabs.filter(isFirefoxTab).find(t => t.url?.includes("youtube.com"));
    if (!yt) {
      throw new Error("no yt tab");
    }

    const target = await rdp.request(yt.actor, "getTarget");
    const frame = target.frame as Record<string, unknown>;
    if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
      throw new Error("no actor");
    }

    const consoleActor = frame.consoleActor;

    const cached = await rdp.request(consoleActor, "getCachedMessages", { messageTypes: ["ConsoleAPI", "PageError"] });
    const list = Array.isArray(cached.messages) ? cached.messages : [];
    console.log(`total cached: ${list.length}`);
    let printed = 0;
    for (const msg of list.slice(-200)) {
      if (!isRecord(msg)) {
        continue;
      }

      const args = Array.isArray(msg.arguments) ? msg.arguments : [];
      const txt = args.map(a => typeof a === "string" ? a : (isRecord(a) && typeof a.preview === "object" ? JSON.stringify(a).slice(0, 150) : String(a))).join(" ");
      const errStr = typeof msg.errorMessage === "string" ? msg.errorMessage : "";
      const finalTxt = txt || errStr;
      if (finalTxt.includes("ytdl") || finalTxt.includes("ffmpeg") || finalTxt.includes("pipeline") || finalTxt.includes("error") || finalTxt.includes("Error")) {
        console.log(`  [${msg.level ?? "?"}] ${finalTxt.slice(0, 280)}`);
        printed++;

        if (printed >= 80) {
          break;
        }
      }
    }
    console.log(`printed ${printed}`);
  } finally {
    rdp.destroy();
  }
}

main().catch(err => {
  console.error(err); process.exit(1);
});
