// Click the download button for first two TalkLinked playlist videos and monitor
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const PLAYLIST_ID = "PL3zIYvF1XjLm5mHJu__9-n0SHMZ3qlaIa";
const VIDEO_1 = "ukYofhuBWEM";
const VIDEO_2 = "bGr3dTK9oAU";

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
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string; title: string }>;
  const tab = targets.find(t => t.type === "page" && t.url.includes(PLAYLIST_ID));
  if (!tab) { console.error("TalkLinked playlist tab not found"); return; }

  console.log("Playlist tab:", tab.title);
  const session = await openSession(tab.webSocketDebuggerUrl);

  await session.send("Runtime.enable");
  session.on("Runtime.consoleAPICalled", (params) => {
    const p = params as { type: string; args: { value?: unknown; description?: string }[] };
    const args = p.args.map(a => a.value ?? a.description ?? "").join(" ");
    if (String(args).includes("ytdl")) {
      console.log(`  [console:${p.type}]`, String(args).slice(0, 200));
    }
  });

  // Check what download buttons are available
  const inspect = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const btn1 = document.querySelector('[data-ytdl-button-id="btn-${VIDEO_1}-download"]');
      const btn2 = document.querySelector('[data-ytdl-button-id="btn-${VIDEO_2}-download"]');
      const allYtdlBtns = document.querySelectorAll('[data-ytdl-button-id]');
      return JSON.stringify({
        btn1Found: !!btn1,
        btn2Found: !!btn2,
        allBtnIds: Array.from(allYtdlBtns).map(b => b.getAttribute('data-ytdl-button-id')).slice(0, 10),
        btn1Tag: btn1?.tagName,
        btn2Tag: btn2?.tagName
      });
    })()`,
    returnByValue: true
  }) as { result: { value?: string } };

  const inspectData = JSON.parse(inspect.result.value ?? "{}");
  console.log("Button inspection:", inspectData);

  if (!inspectData.btn1Found && !inspectData.btn2Found) {
    console.log("Buttons not found by data attr — trying inner button query...");
    // Try finding the download button inside yt-button-view-model within ytdl-download-btn-wrapper
    const altInspect = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const wrappers = document.querySelectorAll('.ytdl-download-btn-wrapper');
        return JSON.stringify({
          wrapperCount: wrappers.length,
          sample: Array.from(wrappers).slice(0, 3).map(w => ({
            html: w.innerHTML.slice(0, 200),
            parentText: w.closest('[class*="ytdl"]')?.className
          }))
        });
      })()`,
      returnByValue: true
    }) as { result: { value?: string } };
    console.log("Wrappers:", JSON.parse(altInspect.result.value ?? "{}"));
    session.close();
    return;
  }

  // Click download for video 1
  if (inspectData.btn1Found) {
    console.log(`\nClicking download for ${VIDEO_1}...`);
    await session.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-ytdl-button-id="btn-${VIDEO_1}-download"]');
        const inner = btn?.querySelector('button') ?? btn;
        inner?.click();
        return 'clicked';
      })()`,
      returnByValue: true
    });
    console.log("Click dispatched for video 1");
    await sleep(3000);
  }

  // Click download for video 2
  if (inspectData.btn2Found) {
    console.log(`\nClicking download for ${VIDEO_2}...`);
    await session.send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('[data-ytdl-button-id="btn-${VIDEO_2}-download"]');
        const inner = btn?.querySelector('button') ?? btn;
        inner?.click();
        return 'clicked';
      })()`,
      returnByValue: true
    });
    console.log("Click dispatched for video 2");
    await sleep(3000);
  }

  console.log("\nMonitoring for 120s (watch for ytdl console messages)...");
  await sleep(120_000);

  session.close();
}

main().catch(console.error);
