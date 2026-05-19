// Test if progressive URL for ukYofhuBWEM is fetchable from Node (simulates background context)
import WebSocket from "ws";

const CDP_URL = "http://localhost:9229";
const VIDEO_ID = "ukYofhuBWEM";

function openSession(wsUrl: string) {
  return new Promise<{ send: (method: string, params?: object) => Promise<unknown>; close: () => void }>((resolve, reject) => {
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
        const handler = pending.get(msg.id);
        if (handler) { pending.delete(msg.id); msg.error ? handler.reject(msg.error) : handler.resolve(msg.result); }
      }
    });
    ws.on("error", reject);
  });
}

async function main() {
  const targets = await (await fetch(`${CDP_URL}/json`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
  const watchTab = targets.find(tab => tab.type === "page" && tab.url.includes(`v=${VIDEO_ID}`));
  if (!watchTab) {
    console.error("No watch tab for", VIDEO_ID, "- navigate to it first");
    return;
  }

  const session = await openSession(watchTab.webSocketDebuggerUrl);

  // Get the progressive URL from the page
  const result = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const pr = window.ytInitialPlayerResponse;
      const formats = pr?.streamingData?.formats ?? [];
      const itag18 = formats.find(f => f.itag === 18 && f.url);
      return itag18?.url ?? null;
    })()`,
    awaitPromise: false,
    returnByValue: true
  }) as { result: { value: string | null } };

  const progressiveUrl = result.result.value;
  if (!progressiveUrl) {
    console.log("No progressive URL found");
    session.close();
    return;
  }

  console.log("Progressive URL (first 120 chars):", progressiveUrl.slice(0, 120));

  // Try to fetch just the headers to check if it's accessible
  for (const [label, headers] of [
    ["No extra headers", {}],
    ["With Origin+Referer", { "Origin": "https://www.youtube.com", "Referer": "https://www.youtube.com/" }]
  ] as [string, Record<string, string>][]) {
    try {
      const response = await fetch(progressiveUrl, {
        method: "HEAD",
        credentials: "include",
        headers
      });
      console.log(`${label}: HTTP ${response.status} ${response.statusText}`);
    } catch (e) {
      console.log(`${label}: fetch error:`, e);
    }
  }

  session.close();
}

main().catch(console.error);
