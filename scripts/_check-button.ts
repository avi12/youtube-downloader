import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const port = await findFirefoxRdpPort();
const rdp = new RDP(port);
await rdp.connect();

const pages = await rdp.listTabs();
const ytTab = pages.find(p => p.url.includes("youtube.com/watch"))!;
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

const result = await rdp.evalInTab(consoleActor, `
  JSON.stringify(
    Array.from(document.querySelectorAll('[data-ytdl-download-group] button'))
      .map(b => b.textContent?.trim())
  )
`);
console.log(result);
process.exit(0);
