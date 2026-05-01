// Dumps cached console messages from the YouTube tab's console actor.
import { findFirefoxRdpPort, isRecord, RDP } from "./firefox-rdp.js";

function formatArg(arg: unknown) {
  if (typeof arg === "string") {
    return arg;
  }

  if (isRecord(arg) && typeof arg.preview === "object") {
    return JSON.stringify(arg).slice(0, 150);
  }

  return String(arg);
}

async function main() {
  const port = findFirefoxRdpPort();
  if (!port) {
    throw new Error("no port");
  }

  console.log(`connecting to RDP port ${port}`);
  const rdp = new RDP(port);
  await rdp.connect();
  try {
    const tabs = await rdp.listTabs();
    const youtubeTab = tabs.find(tab => tab.url?.includes("youtube.com"));
    if (!youtubeTab) {
      throw new Error("no yt tab");
    }

    const consoleActor = await rdp.getConsoleActor(youtubeTab.actor);
    if (!consoleActor) {
      throw new Error("no actor");
    }

    const cached = await rdp.request(consoleActor, "getCachedMessages", { messageTypes: ["ConsoleAPI", "PageError"] });
    const list = Array.isArray(cached.messages) ? cached.messages : [];
    console.log(`total cached: ${list.length}`);
    let printed = 0;
    for (const msg of list.slice(-200)) {
      if (!isRecord(msg)) {
        continue;
      }

      const args = Array.isArray(msg.arguments) ? msg.arguments : [];
      const txt = args.map(formatArg).join(" ");
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
