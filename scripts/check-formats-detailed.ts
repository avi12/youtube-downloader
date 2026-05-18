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
        resolve(msg.result?.result?.value ?? '?');
      }
    });
    socket.on("error", reject);
    setTimeout(() => { socket.close(); reject("timeout"); }, 15000);
  });
}

const detailedFormats = await evalIn(ytPage.webSocketDebuggerUrl!, `
  (() => {
    const playerResponse = window.ytInitialPlayerResponse;
    if (!playerResponse) return 'no player response';
    
    const adaptive = playerResponse.streamingData?.adaptiveFormats ?? [];
    const result = adaptive.slice(0, 10).map(f => ({
      itag: f.itag,
      mimeType: f.mimeType?.split(';')[0],
      hasUrl: !!f.url,
      hasCipher: !!f.signatureCipher || !!f.cipher,
      urlOrCipherPrefix: (f.url || f.signatureCipher || f.cipher || 'none').slice(0, 80)
    }));
    
    return JSON.stringify({
      total: adaptive.length,
      formats: result,
      hasServerAbrStreamingUrl: !!playerResponse.streamingData?.serverAbrStreamingUrl,
      expiresInSeconds: playerResponse.streamingData?.expiresInSeconds
    }, null, 2);
  })()
`);
console.log("Detailed formats:", detailedFormats);
