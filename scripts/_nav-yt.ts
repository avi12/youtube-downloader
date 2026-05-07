import { findFirefoxRdpPort, RDP, isFirefoxTab, isRecord } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const port = findFirefoxRdpPort();
if (!port) { console.error("no RDP port"); process.exit(1); }

const rdp = new RDP(port);
await rdp.connect();

const res = await rdp.request("root", "listTabs");
const tabs = (Array.isArray(res.tabs) ? res.tabs : []).filter(isFirefoxTab);
console.log("Tabs:", tabs.map(t => t.url));

const firstTab = tabs[0];
if (!firstTab) { console.error("No tabs"); rdp.destroy(); process.exit(1); }

const target = await rdp.request(firstTab.actor, "getTarget");
const frame = target.frame;
if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
  console.error("No consoleActor"); rdp.destroy(); process.exit(1);
}
const consoleActor = frame.consoleActor as string;

rdp.send(consoleActor, "evaluateJSAsync", { text: "location.href = 'https://www.youtube.com/watch?v=Vk-_3TfvhZQ'" });
console.log("Navigating...");
await wait(15000);

const res2 = await rdp.request("root", "listTabs");
const tabs2 = (Array.isArray(res2.tabs) ? res2.tabs : []).filter(isFirefoxTab);
console.log("Tabs after nav:", tabs2.map(t => t.url));

rdp.destroy();
