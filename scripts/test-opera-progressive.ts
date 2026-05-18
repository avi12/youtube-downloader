import WebSocket from "ws";

const OPERA_WS = "ws://localhost:9227/devtools/page/8DA34BFFDF8F70F07182B1E12CE48A74";
const VIDEO_ID = "PY32E-YEwxk";

function cdpSend(ws: WebSocket, id: number, method: string, params: Record<string, unknown> = {}) {
  ws.send(JSON.stringify({ id, method, params }));
}

async function cdpEval(ws: WebSocket, expression: string, awaitPromise = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100_000) + 1;
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== id) {
        return;
      }

      ws.off("message", handler);
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.exception?.description ?? "eval failed"));
      } else {
        resolve(msg.result?.result?.value);
      }
    };
    ws.on("message", handler);
    cdpSend(ws, id, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  });
}

const ws = new WebSocket(OPERA_WS);
await new Promise<void>(resolve => ws.once("open", resolve));

console.log("Navigating Opera to video...");
cdpSend(ws, 1, "Page.navigate", { url: `https://www.youtube.com/watch?v=${VIDEO_ID}` });
await new Promise(resolve => setTimeout(resolve, 5000));

const progressiveUrl = await cdpEval(ws, `(function() {
  const pr = window.ytInitialPlayerResponse;
  const formats = pr?.streamingData?.formats ?? [];
  return formats.filter(f => f.url).sort((a,b) => (b.height||0)-(a.height||0))[0]?.url ?? null;
})()`) as string | null;

console.log("Progressive URL:", progressiveUrl ? progressiveUrl.slice(0, 120) + "..." : "none");

if (progressiveUrl) {
  const result = await cdpEval(ws, `(async () => {
    try {
      const r = await fetch(${JSON.stringify(progressiveUrl)}, {
        credentials: "include",
        headers: { Range: "bytes=0-1023" }
      });
      const text = r.ok ? "ok" : await r.text().catch(() => "");
      return { status: r.status, ok: r.ok, info: text.slice(0, 100) };
    } catch(e) {
      return { error: String(e) };
    }
  })()`, true) as { status: number; ok: boolean } | null;
  console.log("Fetch result:", JSON.stringify(result));
}

ws.close();
process.exit(0);
