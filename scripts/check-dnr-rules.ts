import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const allTabs = (await rdp.request("root", "listTabs")).tabs as any[];

for (const tab of allTabs as any[]) {
  if (tab.url !== "about:blank") continue;
  console.log("Trying tab:", tab.actor);
  const cons = await rdp.getConsoleActor(tab.actor);
  const result = await rdp.evalInTab(cons, `
    typeof chrome !== 'undefined' ? 'chrome ok' : typeof browser !== 'undefined' ? 'browser ok' : 'neither'
  `);
  console.log(" ns:", result);

  if (result?.includes("ok")) {
    const ns = result.includes("chrome") ? "chrome" : "browser";
    const rules = await rdp.evalInTab(cons, `
      ${ns}.declarativeNetRequest.getSessionRules().then(r => JSON.stringify(r))
    `);
    await wait(3000);
    console.log(" rules:", rules);
  }
}

rdp.destroy();
