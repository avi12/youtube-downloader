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
// Show unreachable code warnings with source info
all.forEach(m => {
  const pe = (m.pageError as Record<string,string|number>|undefined);
  if (pe?.errorMessageName === "JSMSG_STMT_AFTER_RETURN") {
    console.log("SRC:", pe.sourceName, "line:", pe.lineNumber, "col:", pe.columnNumber);
  }
});
rdp.destroy();
