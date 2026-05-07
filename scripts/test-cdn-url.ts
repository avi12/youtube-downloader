import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.log("No YT tab"); process.exit(1); }
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

// URL from the extension background log (itag=308 video)
const cdnUrl = "https://rr4---sn-nhpax-ua8r.googlevideo.com/videoplayback?expire=1778013646&ei=bgH6aZb6MvGahcIP4ZrO4AM&ip=87.68.192.96&id=o-AN2THPA2kpcgRB5VxQ0VilybF8fQMBqDD8IG-R3koViz&itag=308&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ%3D%3D&cps=411&met=1777992046%2C&mh=Un&mm=31%2C29&mn=sn-nhpax-ua8r%2Csn-4g5lznes&ms=au%2Crdu&mv=m&mvi=4&pl=19&rms=au%2Cau&initcwndbps=1713750&bui=AbKmrwp9PpwwaoM0FO7MonqO_3gArZoZFVMZBsc-MVyI09RB9Q2ATFpcaWpw9YI6J0PwzXZrI8uSyu5F&spc=96Xrv0Z3RhLm4KPKNajIGKYUXbeyZaDAJgQQfjqwuEYnVVSC28Iw-MW_fni5GA&vprv=1&svpuc=1&mime=video%2Fwebm&rqh=1&gir=yes&clen=399766099&dur=694.127&lmt=177774";

// Test from YouTube page context (has cookies but no host_permissions)
await rdp.evalInTab(consoleActor, `
  fetch('${cdnUrl}', { headers: { Range: 'bytes=0-999' } })
    .then(r => console.log('[page] status=' + r.status + ' type=' + r.type))
    .catch(e => console.log('[page] ERR: ' + e.message))
`);
await wait(6000);

// Also test with no-cors mode
await rdp.evalInTab(consoleActor, `
  fetch('${cdnUrl}', { mode: 'no-cors', headers: { Range: 'bytes=0-999' } })
    .then(r => console.log('[no-cors] status=' + r.status + ' type=' + r.type))
    .catch(e => console.log('[no-cors] ERR: ' + e.message))
`);

await wait(5000);
rdp.destroy();
