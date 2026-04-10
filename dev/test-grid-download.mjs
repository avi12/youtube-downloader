import { execSync } from "child_process";
import WebSocket from "ws";

const port = process.argv[2] || "9229";
const pages = JSON.parse(execSync(`curl -s http://localhost:${port}/json/list`).toString());
const page = pages.find(p => p.url.includes("subscriptions") && p.type === "page");
if (!page) {
  console.log("No subscriptions page found");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.on("open", () => {
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression: `
        (async () => {
          const btns = document.querySelectorAll('[data-ytdl-grid-item] yt-button-view-model');
          const gridItems = document.querySelectorAll('[data-ytdl-grid-item]');
          if (btns.length === 0) return JSON.stringify({ error: 'no buttons', gridItems: gridItems.length });

          const btn = btns[0];
          const innerBtn = btn.querySelector('button');
          const videoId = btn.closest('[data-ytdl-grid-item]')?.dataset?.ytdlGridItem;

          innerBtn?.click();

          await new Promise(r => setTimeout(r, 10000));

          const item = document.querySelector('[data-ytdl-grid-item="' + videoId + '"]');
          const progress = item?.querySelector('tp-yt-paper-progress');
          const label = item?.querySelector('button')?.getAttribute('aria-label')?.substring(0, 80);

          return JSON.stringify({
            videoId,
            btnsCount: btns.length,
            hasProgress: !!progress,
            label,
            btnDataType: typeof btn.data,
            hasClickBound: btn.hasAttribute('data-ytdl-click-bound')
          });
        })()
      `,
        awaitPromise: true
      }
    })
  );
});

ws.on("message", raw => {
  const msg = JSON.parse(raw);
  if (msg.id === 1) {
    if (msg.result?.result?.value) {
      console.log(msg.result.result.value);
    } else if (msg.result?.exceptionDetails) {
      console.log("ERROR:", msg.result.exceptionDetails.text);
    }

    ws.close();
    process.exit();
  }
});

setTimeout(() => process.exit(), 20000);
