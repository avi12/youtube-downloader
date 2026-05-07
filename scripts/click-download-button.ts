import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.log("No YT tab"); process.exit(1); }
console.log("Found tab:", ytTab.url);
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

const result = await rdp.evalInTab(consoleActor, `
  (function() {
    const btns = Array.from(document.querySelectorAll('#top-level-buttons-computed button[aria-label="Download"]'));
    if (btns.length === 0) return 'NOT FOUND';
    // Click the last one (extension button, not YouTube native)
    const btn = btns[btns.length - 1];
    btn.click();
    return 'CLICKED (' + btns.length + ' found)';
  })()
`);
console.log("Result:", result);
await wait(3000);
rdp.destroy();
