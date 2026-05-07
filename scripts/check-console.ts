import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.log("No YT tab"); process.exit(1); }
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

// Get recent console messages
const result = await rdp.evalInTab(consoleActor, `
  (function() {
    const btn = document.querySelector('#top-level-buttons-computed button[aria-label="Cancel download"]');
    const btn2 = document.querySelector('#top-level-buttons-computed button[aria-label="Open download options"]');
    return JSON.stringify({ cancelBtn: !!btn, openBtn: !!btn2 });
  })()
`);
console.log("State:", result);

rdp.destroy();
