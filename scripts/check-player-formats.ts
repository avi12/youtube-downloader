import WebSocket from "ws";

const CDP_PORT = 9229;
const CHROME_EXT_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";

const response = await fetch(`http://localhost:${CDP_PORT}/json`);
const targets = await response.json() as Array<{type: string; title: string; url: string; webSocketDebuggerUrl: string; id: string}>;

const ytPage = targets.find(t => t.type === "page" && t.url?.includes("youtube.com/watch") && t.url?.includes("ycXjF91o73I"));
if (!ytPage) { console.log("YT page not found"); process.exit(1); }

async function evalIn(wsUrl: string, expression: string, awaitPromise = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise, returnByValue: true } }));
    });
    socket.on("message", (raw: Buffer) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) {
        socket.close();
        if (msg.result?.exceptionDetails) {
          resolve("ERROR: " + msg.result.exceptionDetails.exception?.description);
        } else {
          resolve(msg.result?.result?.value ?? msg.result?.result?.description ?? JSON.stringify(msg.result?.result));
        }
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

// Check available formats from player response
const formats = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (() => {
    const playerResponse = window.ytInitialPlayerResponse;
    if (!playerResponse) return 'no ytInitialPlayerResponse';
    
    const streamingData = playerResponse.streamingData;
    if (!streamingData) return 'no streamingData';
    
    const formats = streamingData.formats || [];
    const adaptiveFormats = streamingData.adaptiveFormats || [];
    
    const videoFormats = adaptiveFormats
      .filter(f => f.mimeType?.startsWith('video/'))
      .slice(0, 5)
      .map(f => ({ 
        itag: f.itag, 
        mimeType: f.mimeType?.split(';')[0], 
        quality: f.qualityLabel,
        hasUrl: !!f.url,
        hasCdnUrl: !!f.url && !f.url.includes('expire=0'),
        urlPrefix: f.url?.slice(0, 60) ?? 'no url'
      }));
    
    const audioFormats = adaptiveFormats
      .filter(f => f.mimeType?.startsWith('audio/'))
      .slice(0, 5)
      .map(f => ({
        itag: f.itag,
        mimeType: f.mimeType?.split(';')[0],
        bitrate: f.bitrate,
        hasUrl: !!f.url,
        hasCdnUrl: !!f.url && !f.url.includes('expire=0'),
        urlPrefix: f.url?.slice(0, 60) ?? 'no url'
      }));
    
    return JSON.stringify({
      hasAdaptiveFormats: adaptiveFormats.length > 0,
      videoCount: videoFormats.length,
      audioCount: audioFormats.length,
      expiresInSeconds: streamingData.expiresInSeconds,
      videoFormats,
      audioFormats
    }, null, 2);
  })()
`);
console.log("Player formats:", formats);
