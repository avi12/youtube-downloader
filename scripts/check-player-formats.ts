import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.log("No YT tab"); process.exit(1); }
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

// Check if the main player returns CDN URLs or SABR-only
await rdp.evalInTab(consoleActor, `
  (async function() {
    const resp = await fetch('/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20260430.08.00', hl: 'en', gl: 'US' } },
        videoId: 'Vk-_3TfvhZQ',
        racyCheckOk: true,
        contentCheckOk: true
      })
    });
    const data = await resp.json();
    const formats = [...(data.streamingData?.adaptiveFormats ?? []), ...(data.streamingData?.formats ?? [])];
    const withUrl = formats.filter(f => f.url);
    const withDashUrl = formats.filter(f => f.streamingData?.dashManifestUrl);
    const sample = withUrl[0];
    const sampleParams = sample ? (() => { const u = new URL(sample.url); return ['id','n','rqh','c'].map(p => p+'='+u.searchParams.get(p)).join(' '); })() : 'none';
    console.log('[player-web] formats=' + formats.length + ' withUrl=' + withUrl.length + ' sample=' + sampleParams);
    if (data.streamingData?.hlsManifestUrl) console.log('[player-web] HLS manifest present');
    if (data.streamingData?.dashManifestUrl) console.log('[player-web] DASH manifest present');
    console.log('[player-web] playability=' + data.playabilityStatus?.status);
  })()
`);
await wait(8000);
rdp.destroy();
