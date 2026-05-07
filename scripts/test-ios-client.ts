import { setTimeout as wait } from "node:timers/promises";
import { RDP, findFirefoxRdpPort } from "./firefox-rdp.ts";

const rdp = new RDP(findFirefoxRdpPort());
await rdp.connect();
const tabs = await rdp.listTabs();
const ytTab = tabs.find(t => t.url?.includes("youtube.com/watch"));
if (!ytTab) { console.log("No YT tab"); process.exit(1); }
const consoleActor = await rdp.getConsoleActor(ytTab.actor);

// Get SAPISIDHASH via cookies
const cookieResult = await rdp.evalInTab(consoleActor, `
  (async function() {
    const cookie = document.cookie.split('; ').find(c => c.startsWith('__Secure-3PAPISID='));
    if (!cookie) return 'NO_COOKIE';
    const value = cookie.split('=')[1];
    const ts = Math.floor(Date.now() / 1000);
    const msg = ts + ' ' + value + ' https://www.youtube.com';
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(msg));
    const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    return 'SAPISIDHASH ' + ts + '_' + hash;
  })()
`);
await wait(2000);
console.log("Auth:", cookieResult?.slice(0, 50) ?? "null");

const auth = cookieResult;

const code = `(async function() {
  const resp = await fetch(
    'https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': '5',
        'X-Youtube-Client-Version': '20.10.4',
        'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
        ${auth && !auth.startsWith("NO_") ? `'Authorization': '${auth}',` : ""}
      },
      body: JSON.stringify({
        context: { client: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.1.0.22B83', hl: 'en', gl: 'US', userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)' } },
        videoId: 'Vk-_3TfvhZQ',
        racyCheckOk: true,
        contentCheckOk: true
      })
    }
  );
  const data = await resp.json();
  const formats = [...(data.streamingData?.adaptiveFormats ?? []), ...(data.streamingData?.formats ?? [])];
  const withUrl = formats.filter(f => f.url);
  if (withUrl.length === 0) return 'NO_URLS: ' + formats.length + ' total. Status: ' + (data.playabilityStatus?.status);
  const sample = withUrl.find(f => f.itag === 140) || withUrl[0];
  const u = new URL(sample.url);
  const params = ['id','n','rqh','xpc'].map(p => p + '=' + (u.searchParams.get(p) ?? 'null')).join(' ');
  return 'IOS OK: itag=' + sample.itag + ' ' + params + ' fullUrl=' + sample.url.slice(0,200);
})()`;

await rdp.evalInTab(consoleActor, `${code}.then(r => console.log('[ios]', r)).catch(e => console.log('[ios] ERR:', e.message))`);
await wait(8000);
rdp.destroy();
