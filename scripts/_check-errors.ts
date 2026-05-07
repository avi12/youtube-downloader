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
const all = msgs.messages || [];
console.log(`Total cached msgs: ${all.length}`);
all.slice(-15).forEach((m: {level?:string, arguments?: {value:string}[], text?: string, errorMessage?: string}) => {
  const txt = m.arguments?.[0]?.value ?? m.text ?? m.errorMessage ?? "";
  console.log(`[${m.level || "err"}] ${txt.slice(0, 150)}`);
});
rdp.destroy();
