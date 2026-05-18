import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const ytPage = targets.find(t => t.type === "page" && t.url?.includes("youtube.com/watch") && t.url?.includes("ycXjF91o73I"));
if (!ytPage) { console.log("YT page not found"); process.exit(1); }

async function evalIn(wsUrl: string, expression: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) {
        socket.close();
        resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? '?');
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

// Look for the extension's cached data  
// The content script uses ytInitialData/ytInitialPlayerResponse on load
// Check if there's a way to see the resolved itags + format URLs
const contentState = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (() => {
    // Try to find the extension's state through its DOM
    // The extension injects custom elements, look for ytdl-specific attributes or state
    
    // Check panel's data attributes
    const panel = document.querySelector('#ytdl-download-panel') || document.querySelector('[id*="ytdl"]');
    if (panel) {
      const attrs = {};
      for (const attr of panel.attributes) {
        attrs[attr.name] = attr.value.slice(0, 100);
      }
      return 'panel attrs: ' + JSON.stringify(attrs);
    }
    
    // Try window-level extension state
    const keys = Object.keys(window).filter(k => k.includes('ytdl') || k.includes('YTDL'));
    return 'window keys: ' + JSON.stringify(keys.slice(0, 20));
  })()
`);
console.log("Content state:", contentState);

// Try to read the format from ytcfg or player config
const ytcfgData = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (() => {
    // ytcfg contains the YouTube client config
    if (typeof ytcfg === 'undefined') return 'no ytcfg';
    const cfg = ytcfg.data_;
    return JSON.stringify({
      clientName: cfg?.INNERTUBE_CLIENT_NAME,
      clientVersion: cfg?.INNERTUBE_CLIENT_VERSION,
      visitorData: cfg?.VISITOR_DATA?.slice(0, 20)
    });
  })()
`);
console.log("ytcfg data:", ytcfgData);

// Check what format the panel actually has selected
// This is what gets used when download is triggered
const panelData = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (() => {
    // Look for the quality/format selector values
    const qualEls = document.querySelectorAll('[data-value]');
    const selected = [...qualEls].filter(el => el.closest('[aria-selected="true"]') || el.hasAttribute('aria-selected'));
    
    // Find ytdl extension visible elements
    const downloadPanel = document.querySelector('#related-chips, .ytdl-panel-wrapper, [class*="download-panel"]');
    const selects = document.querySelectorAll('[id*="ytdl"]');
    const selectInfo = [...selects].map(el => ({ 
      id: el.id, 
      text: el.textContent?.trim().slice(0, 50) 
    }));
    
    return JSON.stringify({ 
      selectInfo: selectInfo.slice(0, 5),
      hasPanel: !!downloadPanel
    });
  })()
`);
console.log("Panel data:", panelData);

// Check if ytInitialPlayerResponse has a different format in streaming context
// (the Svelte content script accesses it in the MAIN world)
const mainWorldFormats = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (() => {
    // Look at window.__ytdlStreamingData if set by extension 
    if (window.__ytdlStreamingData) return JSON.stringify(window.__ytdlStreamingData);
    
    // Check live player state
    const player = document.querySelector('.html5-main-video') || 
                   document.querySelector('video.html5-main-video');
    if (player) {
      const src = player.src;
      return 'video src type: ' + (src.startsWith('blob:') ? 'blob' : src.startsWith('https://') ? 'https:' : src.slice(0,50));
    }
    
    return 'no streaming data found';
  })()
`);
console.log("Main world formats:", mainWorldFormats);
