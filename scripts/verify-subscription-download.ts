// Drives a Firefox tab via the Remote Debugging Protocol (RDP) to verify that
// clicking "Download" on a subscription-grid tile produces a complete file.
// Workaround for when the firefox-devtools MCP isn't available — uses
// `web-ext run`'s built-in RDP socket directly.
//
// Usage:
//   1. Start Firefox via `pnpm dev:stable-firefox` (RDP enabled automatically).
//   2. Run: bun scripts/verify-subscription-download.ts
//
// The script:
//   1. Connects to Firefox RDP on the dynamic port (--start-debugger-server)
//   2. Lists tabs, navigates the active tab to /feed/subscriptions
//   3. Picks the first 10+ minute video tile, clicks its download trigger
//   4. Polls the tile's button aria-label for "Downloaded" or "Done"
//   5. Reports completion or failure
import { connect, type Socket } from "node:net";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const RDP_PORT_FILE = resolve(".output/firefox-mv3-dev/.rdp-port");
const POLL_INTERVAL_MS = 5_000;
const COMPLETION_TIMEOUT_MS = 600_000;
const NAV_DELAY_MS = 8_000;

interface RdpClient {
  send: (msg: object) => Promise<Record<string, unknown>>;
  close: () => void;
}

function readRdpPort(): number {
  try {
    return parseInt(readFileSync(RDP_PORT_FILE, "utf8").trim(), 10);
  } catch {
    return 6080;
  }
}

function connectRdp(port: number): Promise<RdpClient> {
  return new Promise((resolveSocket, reject) => {
    const socket = connect(port, "127.0.0.1");
    let buffer = "";
    const pending: Array<(msg: Record<string, unknown>) => void> = [];

    socket.on("connect", () => {
      resolveSocket({
        send(msg: object) {
          return new Promise<Record<string, unknown>>(resolveResponse => {
            const json = JSON.stringify(msg);
            socket.write(`${json.length}:${json}`);
            pending.push(resolveResponse);
          });
        },
        close() {
          socket.end();
        }
      });
    });

    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      while (true) {
        const colonIdx = buffer.indexOf(":");
        if (colonIdx === -1) {
          break;
        }
        const length = parseInt(buffer.slice(0, colonIdx), 10);
        if (Number.isNaN(length) || buffer.length < colonIdx + 1 + length) {
          break;
        }
        const payload = buffer.slice(colonIdx + 1, colonIdx + 1 + length);
        buffer = buffer.slice(colonIdx + 1 + length);
        const decoded = JSON.parse(payload) as Record<string, unknown>;
        const next = pending.shift();
        if (next) {
          next(decoded);
        }
      }
    });

    socket.on("error", reject);
  });
}

async function attachActiveTab(client: RdpClient) {
  const list = await client.send({ to: "root", type: "listTabs" }) as {
    tabs?: Array<{ actor: string; title: string; url: string; consoleActor: string }>;
  };
  const tab = list.tabs?.[0];
  if (!tab) {
    throw new Error("no tabs");
  }
  return tab;
}

async function evaluateInTab(client: RdpClient, consoleActor: string, expression: string) {
  const result = await client.send({
    to: consoleActor,
    type: "evaluateJSAsync",
    text: expression
  }) as { resultID?: string };
  if (!result.resultID) {
    return null;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const next = await client.send({
      to: consoleActor,
      type: "getCachedMessages"
    }) as Record<string, unknown>;
    if (next) {
      return next;
    }
  }
  return null;
}

async function navigateTab(client: RdpClient, tabActor: string, url: string) {
  await client.send({
    to: tabActor,
    type: "navigateTo",
    url
  });
  await new Promise(timer => setTimeout(timer, NAV_DELAY_MS));
}

const PICK_AND_CLICK_EXPRESSION = `(() => {
  const tiles = document.querySelectorAll('ytd-rich-item-renderer');
  for (const tile of tiles) {
    const link = tile.querySelector('a[href^="/watch?"]')?.getAttribute('href') ?? '';
    const badge = tile.querySelector('.ytThumbnailBadgeViewModelBadgeText, .badge-shape-wiz__text');
    const durationText = (badge?.textContent ?? '').trim();
    if (!durationText) continue;
    const parts = durationText.split(':').map(n => parseInt(n, 10));
    let totalSec = 0;
    for (const p of parts) totalSec = totalSec * 60 + p;
    if (totalSec < 600) continue;
    const dlBtn = Array.from(tile.querySelectorAll('button')).find(b => /\\.(webm|mp4)/i.test(b.getAttribute('aria-label') ?? ''));
    if (!dlBtn) continue;
    dlBtn.click();
    return JSON.stringify({ link, durationText, totalSec });
  }
  return JSON.stringify({ ok: false });
})()`;

const READ_PROGRESS_EXPRESSION = `(() => {
  const buttons = Array.from(document.querySelectorAll('ytd-rich-item-renderer button'));
  for (const btn of buttons) {
    const aria = btn.getAttribute('aria-label') ?? '';
    if (/Downloading|Downloaded|^\\d+%/.test(aria)) {
      return aria;
    }
  }
  return '';
})()`;

async function main() {
  const port = readRdpPort();
  console.log(`[verify] connecting to Firefox RDP on port ${port}`);
  const client = await connectRdp(port);

  try {
    const tab = await attachActiveTab(client);
    console.log(`[verify] tab=${tab.title.slice(0, 60)} url=${tab.url}`);
    await navigateTab(client, tab.actor, "https://www.youtube.com/feed/subscriptions");

    const pickResult = await evaluateInTab(client, tab.consoleActor, PICK_AND_CLICK_EXPRESSION);
    console.log(`[verify] pick result: ${JSON.stringify(pickResult)}`);

    const startTime = Date.now();
    while (Date.now() - startTime < COMPLETION_TIMEOUT_MS) {
      const progress = await evaluateInTab(client, tab.consoleActor, READ_PROGRESS_EXPRESSION);
      console.log(`[verify] @${Math.round((Date.now() - startTime) / 1000)}s ${JSON.stringify(progress)}`);
      const text = JSON.stringify(progress);
      if (text.includes("Downloaded") || text.includes("Download again")) {
        console.log("[verify] DONE");
        client.close();
        return;
      }
      await new Promise(timer => setTimeout(timer, POLL_INTERVAL_MS));
    }
    console.log("[verify] FAILED: timeout reached");
  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
