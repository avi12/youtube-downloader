import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
const port = findFirefoxRdpPort();
const rdp = new RDP(port!);
await rdp.connect();
const res = await rdp.request("root", "listTabs");
const yt = (res.tabs as {url?:string,actor:string}[]).find(t => t.url?.includes("youtube.com/watch"));
const target = await rdp.request(yt!.actor, "getTarget");
const ca = (target.frame as {consoleActor:string}).consoleActor;
await rdp.request(ca, "startListeners", { listeners: ["PageError", "ConsoleAPI"] });

const msgs = await rdp.request(ca, "getCachedMessages", { messageTypes: ["ConsoleAPI", "PageError"] });
const all = (msgs.messages || []) as Record<string, unknown>[];
console.log(`Total cached msgs: ${all.length}`);
// Show all googlevideo-related messages
all.forEach(m => {
  const pe = (m.pageError as Record<string,string>|undefined);
  const msg = pe?.errorMessage ?? "";
  if (msg.includes("googlevideo") || msg.includes("ytdl") || msg.includes("SABR") || msg.includes("ffmpeg")) {
    console.log("MSG:", msg.slice(0, 400));
  }
});
rdp.destroy();
