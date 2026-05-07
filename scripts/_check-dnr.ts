import { findFirefoxRdpPort, RDP, isFirefoxTab } from "./firefox-rdp.js";

const port = findFirefoxRdpPort();
if (!port) { console.error("no RDP port"); process.exit(1); }

const rdp = new RDP(port);
await rdp.connect();

const res = await rdp.request("root", "listTabs");
const tabs = (Array.isArray(res.tabs) ? res.tabs : []).filter(isFirefoxTab);

// Find the extension background page
const bgTab = tabs.find(t => t.url?.includes("moz-extension") || t.url?.includes("background"));
const allUrls = tabs.map(t => t.url);
console.log("All tab URLs:", JSON.stringify(allUrls.slice(0, 10)));

// Try to find background via different method
const allTabs = await rdp.request("root", "listTabs");
console.log("Tab count:", Array.isArray(allTabs.tabs) ? allTabs.tabs.length : 0);
console.log("First tab:", JSON.stringify((allTabs.tabs as any)?.[0]));

rdp.destroy();
