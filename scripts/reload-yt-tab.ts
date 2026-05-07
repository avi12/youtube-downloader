import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.log("No YT tab"); process.exit(1); }
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

await rdp.evalInTab(consoleActor, `location.reload()`);
console.log("Page reloaded");
await wait(1000);
rdp.destroy();
