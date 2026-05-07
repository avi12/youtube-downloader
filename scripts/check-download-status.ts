import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const port = await findFirefoxRdpPort();
const rdp = new RDP(port);
await rdp.connect();

const pages = await rdp.listTabs();
const ytTab = pages.find(p => p.url.includes("youtube.com/watch"))!;
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

const clickResult = await rdp.evalInTab(consoleActor, `
  JSON.stringify((() => {
    const ytdlBtns = Array.from(document.querySelectorAll('[data-ytdl-download-group] button'));
    const downloadBtn = ytdlBtns.find(b => b.textContent?.trim() === 'Download');
    if (!downloadBtn) return { found: false, btns: ytdlBtns.map(b => b.textContent?.trim()) };
    downloadBtn.click();
    return { found: true, clicked: 'Download' };
  })())
`);
console.log("Click:", clickResult);

process.exit(0);
