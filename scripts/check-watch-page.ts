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
  // Find the watch tab
  let targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string; id: string }>;
  let watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) { console.error("No watch tab for", VIDEO_ID); return; }

  const pageSession = await openSession(watchTab.webSocketDebuggerUrl);

  // Check if page is fully loaded
  const docState = await pageSession.send("Runtime.evaluate", {
    expression: `JSON.stringify({ readyState: document.readyState, title: document.title?.slice(0,60), hasInitialData: typeof ytInitialData !== 'undefined', hasPlayerResp: typeof ytInitialPlayerResponse !== 'undefined' })`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Doc state:", docState.result.value);

  // Check player state
  const playerState = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const player = document.querySelector('#movie_player');
      const video = document.querySelector('video');
      return JSON.stringify({
        hasPlayer: !!player,
        playerClass: player?.className?.slice?.(0,60),
        videoExists: !!video,
        videoSrc: video?.currentSrc?.slice?.(0,80),
        networkState: video?.networkState,
        readyState: video?.readyState,
        buffered: video?.buffered?.length > 0 ? video.buffered.end(video.buffered.length-1) : 0,
        currentTime: video?.currentTime,
        paused: video?.paused
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Player:", playerState.result.value);

  // Try clicking play
  const playResult = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector('.ytp-play-button, [aria-label="Play"]');
      if (btn) { btn.click(); return 'clicked play btn'; }
      const video = document.querySelector('video');
      if (video) { video.play()?.catch(()=>{}); return 'called video.play()'; }
      return 'no play element';
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Play attempt:", playResult.result.value);

  await sleep(5000);

  const playerState2 = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const video = document.querySelector('video');
      return JSON.stringify({
        networkState: video?.networkState,
        buffered: video?.buffered?.length > 0 ? video.buffered.end(video.buffered.length-1) : 0,
        currentTime: video?.currentTime,
        src: video?.currentSrc?.slice?.(0,80)
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Player after 5s:", playerState2.result.value);

  pageSession.close();
}

main().catch(console.error);
