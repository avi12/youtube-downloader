// Check if ukYofhuBWEM formats have CDN URLs from its watch page
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    ws.on("open", () => resolve({
      send(method: string, params: object = {}) {
        return new Promise((res, rej) => {
          const id = msgId++;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { ws.close(); }
    }));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const h = pending.get(msg.id);
        if (h) { pending.delete(msg.id); msg.error ? h.reject(msg.error) : h.resolve(msg.result); }
      }
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;

  // Look for an existing watch page for this video
  const watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) {
    // Look for any YouTube page to open the video
    const ytTab = targets.find(t => t.type === "page" && t.url.includes("youtube.com"));
    if (!ytTab) { console.error("No YouTube tab found"); return; }

    const session = await openSession(ytTab.webSocketDebuggerUrl);
    console.log("Opening watch page for", VIDEO_ID);
    await session.send("Page.navigate", { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
    await sleep(5000);

    const targetsAfter = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const watchTabAfter = targetsAfter.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
    if (!watchTabAfter) { console.error("Watch tab not found after navigation"); session.close(); return; }

    const watchSession = await openSession(watchTabAfter.webSocketDebuggerUrl);
    await checkFormats(watchSession);
    watchSession.close();
    session.close();
    return;
  }

  const session = await openSession(watchTab.webSocketDebuggerUrl);
  await checkFormats(session);
  session.close();
}

async function checkFormats(session: Awaited<ReturnType<typeof openSession>>) {
  const result = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const pr = window.ytInitialPlayerResponse;
      if (!pr?.streamingData) return JSON.stringify({ error: 'no streamingData' });
      const adaptive = pr.streamingData.adaptiveFormats ?? [];
      const progressive = pr.streamingData.formats ?? [];
      const vFormats = adaptive.filter(f => f.mimeType?.startsWith('video/'));
      const aFormats = adaptive.filter(f => f.mimeType?.startsWith('audio/'));
      const sv = vFormats[0];
      const sa = aFormats[0];
      const sp = progressive[0];
      return JSON.stringify({
        playabilityStatus: pr.playabilityStatus?.status,
        videoFormats: vFormats.length,
        audioFormats: aFormats.length,
        progressiveFormats: progressive.length,
        hasSabrUrl: !!pr.streamingData.serverAbrStreamingUrl,
        sabrUrl: pr.streamingData.serverAbrStreamingUrl?.slice(0, 80),
        sampleVideo: {
          itag: sv?.itag,
          mimeType: sv?.mimeType?.slice(0, 40),
          hasUrl: !!sv?.url,
          hasCipher: !!sv?.signatureCipher,
          urlSlice: sv?.url?.slice(0, 80) ?? null
        },
        sampleAudio: {
          itag: sa?.itag,
          mimeType: sa?.mimeType?.slice(0, 40),
          hasUrl: !!sa?.url,
          hasCipher: !!sa?.signatureCipher,
          urlSlice: sa?.url?.slice(0, 80) ?? null
        },
        sampleProgressive: sp ? {
          itag: sp.itag,
          mimeType: sp.mimeType?.slice(0, 40),
          hasUrl: !!sp.url,
          hasCipher: !!sp.signatureCipher,
          quality: sp.quality,
          urlFull: sp.url ?? null
        } : null
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Format info:", result.result.value);
}

main().catch(console.error);
