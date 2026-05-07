import { findFirefoxRdpPort, isFirefoxTab, RDP } from "./firefox-rdp.js";
import { setTimeout as wait } from "node:timers/promises";

const port = await findFirefoxRdpPort();
const rdp = new RDP(port);
await rdp.connect();
await wait(300);

const { tabs } = await rdp.request("root", "listTabs", {});
const ytTab = (tabs as any[]).find((t: any) => isFirefoxTab(t) && t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.error("No YT tab"); process.exit(1); }

const { consoleActor } = await rdp.request(ytTab.actor, "attach", {});
await wait(200);

const cancel = await rdp.evalInTab(consoleActor, `(() => {
  const btn = document.querySelector('.ytdl-download-button button');
  if (!btn) return 'no button';
  btn.click();
  return 'clicked: ' + btn.textContent?.trim();
})()`);
console.log("Cancel/toggle:", cancel);
await wait(1500);

const dl = await rdp.evalInTab(consoleActor, `(() => {
  const btn = document.querySelector('.ytdl-download-button button');
  if (!btn) return 'no button';
  const txt = btn.textContent?.trim();
  if (txt !== 'Download') return 'state: ' + txt;
  btn.click();
  return 'started download';
})()`);
console.log("Download:", dl);
await wait(500);

const final = await rdp.evalInTab(consoleActor, `document.querySelector('.ytdl-download-button button')?.textContent?.trim() ?? 'gone'`);
console.log("Final state:", final);
rdp.destroy();
