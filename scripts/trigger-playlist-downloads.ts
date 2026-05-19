// Navigate to TalkLinked playlist and click download for first 2 videos,
// then monitor extension console output for progress.
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";

type Target = { type: string; url: string; webSocketDebuggerUrl: string; id: string; title: string };

function openSession(wsUrl: string) {
  return new Promise<{
    send: (method: string, params?: object) => Promise<unknown>;
    on: (event: string, cb: (params: unknown) => void) => void;
    close: () => void;
  }>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    const listeners = new Map<string, ((params: unknown) => void)[]>();
    ws.on("open", () => resolve({
      send(method: string, params: object = {}) {
        return new Promise((res, rej) => {
          const id = msgId++;
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      on(event: string, cb: (params: unknown) => void) {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(cb);
      },
      close() { ws.close(); }
    }));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
      if (msg.id !== undefined) {
        const handler = pending.get(msg.id);
        if (handler) { pending.delete(msg.id); msg.error ? handler.reject(msg.error) : handler.resolve(msg.result); }
      } else if (msg.method) {
        const cbs = listeners.get(msg.method) ?? [];
        for (const cb of cbs) cb(msg.params);
      }
    });
    ws.on("error", reject);
  });
}

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Target[];

  // Find or use the TalkLinked playlist tab
  let playlistTab = targets.find(t => t.type === "page" && t.url.includes("PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa"));
  if (!playlistTab) {
    console.error("TalkLinked playlist tab not found");
    return;
  }

  console.log("Using tab:", playlistTab.title, playlistTab.url);
  const session = await openSession(playlistTab.webSocketDebuggerUrl);

  // Enable console logging
  await session.send("Runtime.enable");
  session.on("Runtime.consoleAPICalled", (params) => {
    const p = params as { type: string; args: { value?: unknown }[] };
    if (p.type === "warning" || p.type === "error" || p.type === "log") {
      const args = p.args.map(a => a.value ?? "").join(" ");
      if (String(args).includes("ytdl")) {
        console.log(`[CONSOLE:${p.type}]`, args);
      }
    }
  });

  // Wait for page to settle
  await sleep(2000);

  // Check current URL - may need to navigate
  const urlResult = await session.send("Runtime.evaluate", {
    expression: "location.href",
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Current URL:", urlResult.result.value);

  // Find the first two download buttons on the playlist
  const buttonsResult = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const buttons = document.querySelectorAll('.ytdl-download-btn');
      return JSON.stringify({
        count: buttons.length,
        first4: Array.from(buttons).slice(0, 4).map(b => ({
          text: b.textContent?.trim().slice(0, 30),
          disabled: b.hasAttribute('disabled'),
          className: b.className.slice(0, 80)
        }))
      });
    })()`,
    returnByValue: true
  }) as { result: { value: string } };
  console.log("Download buttons:", JSON.parse(buttonsResult.result.value));

  session.close();
}

main().catch(console.error);
