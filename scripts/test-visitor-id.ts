import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.log("No YT tab"); process.exit(1); }
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

// Get visitor data from the page
await rdp.evalInTab(consoleActor, `
  (function() {
    try {
      const vd = window.ytcfg?.get?.('VISITOR_DATA') || window.yt?.config_?.VISITOR_DATA;
      console.log('[vd]', vd ? vd.slice(0, 80) : 'NOT FOUND');
    } catch(e) { console.log('[vd] ERR:', e.message); }
  })()
`);
await wait(2000);

// Test the CDN URL with X-Goog-Visitor-Id
const cdnUrl = "https://rr4---sn-nhpax-ua8r.googlevideo.com/videoplayback?expire=1778013955&ei=owL6abSPMN-izPsPtOPrwAM&ip=87.68.192.96&id=o-AF1s6LAme99VhKmjKs9Pv8yexVnH3ulCait12ReqcJoJ&itag=140&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ%3D%3D&cps=662&met=1777992355%2C&mh=Un&mm=31%2C29&mn=sn-nhpax-ua8r%2Csn-4g5ednse&ms=au%2Crdu&mv=m&mvi=4&pl=19&rms=au%2Cau&initcwndbps=1563750&bui=AbKmrwo2nGh2a7H8nuFixFgVYY1-QNXlww2JtpnpFGOBAcE6aSuTxRVJOrhskWjjHGhmuIN-0zdg2HOa&spc=96Xrv8WxLa_FhRY8bRLffDmzwHiN_It3F1402tN1AlacM_CTsikBEcYtiPF0tQ&vprv=1&svpuc=1&mime=audio%2Fmp4&rqh=1&gir=yes&clen=11235399&dur=694.183&lmt=17777472";

await rdp.evalInTab(consoleActor, `
  (async function() {
    const vd = window.ytcfg?.get?.('VISITOR_DATA') || window.yt?.config_?.VISITOR_DATA;
    const headers = { Range: 'bytes=0-999' };
    if (vd) headers['X-Goog-Visitor-Id'] = vd;
    const r = await fetch('${cdnUrl}', { mode: 'no-cors', headers }).catch(e => null);
    console.log('[rqh-test] vd=', vd ? vd.slice(0,30) : 'null', 'status=', r?.status, 'type=', r?.type);
  })()
`);
await wait(5000);

rdp.destroy();
