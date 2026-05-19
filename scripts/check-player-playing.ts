import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

function openSession(wsUrl: string): Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    ws.on("open", () => {
      resolve({
        send(method: string, params: object = {}) {
          return new Promise((res, rej) => {
            const id = msgId++;
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { ws.close(); }
      });
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const handler = pending.get(msg.id);
        if (handler) {
          pending.delete(msg.id);
          if (msg.error) handler.reject(msg.error);
          else handler.resolve(msg.result);
        }
      }
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const watchTab = targets.find(t => t.type === "page" && t.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) { console.error("Watch tab not found for", VIDEO_ID); return; }

  const pageSession = await openSession(watchTab.webSocketDebuggerUrl);

  // Check player state
  const result = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const player = document.querySelector('#movie_player');
      if (!player) return JSON.stringify({ error: 'no player' });
      const videoEl = document.querySelector('video');
      return JSON.stringify({
        playerState: player.getPlayerState?.(),
        currentTime: videoEl?.currentTime,
        paused: videoEl?.paused,
        readyState: videoEl?.readyState,
        buffered: videoEl?.buffered?.length > 0 ? videoEl.buffered.end(videoEl.buffered.length - 1) : 0,
        error: videoEl?.error?.message,
        networkState: videoEl?.networkState,
        videoWidth: videoEl?.videoWidth,
        videoHeight: videoEl?.videoHeight
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Player state:", result.result.value);

  // Try to start playback
  const playResult = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const video = document.querySelector('video');
      if (!video) return 'no video element';
      video.play().catch(e => console.log('play error:', e.message));
      return 'play initiated';
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Play:", playResult.result.value);

  // Wait and check
  await sleep(3000);
  const result2 = await pageSession.send("Runtime.evaluate", {
    expression: `(() => {
      const videoEl = document.querySelector('video');
      return JSON.stringify({
        currentTime: videoEl?.currentTime,
        paused: videoEl?.paused,
        buffered: videoEl?.buffered?.length > 0 ? videoEl.buffered.end(videoEl.buffered.length - 1) : 0,
        error: videoEl?.error?.code,
        networkState: videoEl?.networkState
      });
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Player state after 3s:", result2.result.value);

  pageSession.close();
}

main().catch(console.error);
