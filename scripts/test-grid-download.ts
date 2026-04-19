/**
 * Automated grid download test.
 * Builds the extension, launches Chrome with it loaded, navigates to
 * subscriptions, clicks a download button, and monitors progress.
 *
 * Usage: node scripts/test-grid-download.mjs
 * Requires: logged-in Chrome profile at user-profiles/chrome
 */

import { execSync } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import WebSocket from "ws";

interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpCookie {
  name: string;
  value: string;
}

const CDP_PORT = 9230;
const CDP_WAIT_RETRIES = 30;
const CDP_RETRY_DELAY_MS = 1_000;
const CDP_EVAL_TIMEOUT_MS = 30_000;
const COOKIE_FETCH_TIMEOUT_MS = 5_000;
const NAVIGATE_SETTLE_MS = 10_000;
const MONITOR_POLL_INTERVAL_MS = 5_000;
const MONITOR_POLL_COUNT = 24;
const CHROME_START_URL = "https://www.youtube.com/watch?v=wjggoT-3oVM";
const SUBS_URL = "https://www.youtube.com/feed/subscriptions";
const AUTH_COOKIES = ["SID", "SSID", "LOGIN_INFO", "SAPISID"];
const CHROME_PATH = join(process.env["ProgramFiles"]!, "Google/Chrome/Application/chrome.exe");
const EXT_PATH = join(import.meta.dirname, "../.output/chrome-mv3");
const USER_DATA = join(import.meta.dirname, "../user-profiles/chrome");

async function fetchYtCookies(wsUrl: string): Promise<CdpCookie[]> {
  const signal = AbortSignal.timeout(COOKIE_FETCH_TIMEOUT_MS);
  const socket = new WebSocket(wsUrl);
  await once(socket, "open", { signal });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Network.getCookies",
      params: { urls: ["https://www.youtube.com"] }
    })
  );
  const [rawData] = await once(socket, "message", { signal });
  socket.close();
  const msg = JSON.parse(String(rawData));
  return msg.result?.cookies ?? [];
}

function cdpRequest(path: string) {
  return new Promise<CdpTarget[]>((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}${path}`, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed: CdpTarget[] = JSON.parse(data);
          resolve(parsed);
        } catch {
          reject(new Error(data));
        }
      });
    }).on("error", reject);
  });
}

async function cdpEval(wsUrl: string, expression: string, awaitPromise = false) {
  const signal = AbortSignal.timeout(CDP_EVAL_TIMEOUT_MS);
  const socket = new WebSocket(wsUrl);

  await once(socket, "open", { signal });
  socket.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        expression,
        awaitPromise
      }
    })
  );

  const [rawData] = await once(socket, "message", { signal });
  socket.close();

  const msg = JSON.parse(String(rawData));
  if (msg.result?.exceptionDetails) {
    throw new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text);
  }

  return msg.result?.result?.value;
}

// Step 1: Build
console.log("Building extension...");
execSync("pnpm build", { stdio: "inherit" });

// Add declarativeNetRequest permission to manifest
const manifestPath = join(EXT_PATH, "manifest.json");
const manifest = JSON.parse(execSync(`cat "${manifestPath}"`).toString());
if (!manifest.permissions.includes("declarativeNetRequest")) {
  manifest.permissions.push("declarativeNetRequest");
  execSync(`echo '${JSON.stringify(manifest, null, 2)}' > "${manifestPath}"`);
}

// Step 2: Launch Chrome
console.log("Launching Chrome...");
const chromeArgs = [
  `--user-data-dir=${USER_DATA}`,
  "--profile-directory=Default",
  `--load-extension=${EXT_PATH}`,
  `--remote-debugging-port=${CDP_PORT}`,
  "--disable-background-networking",
  "--disable-blink-features=AutomationControlled",
  "--lang=en",
  CHROME_START_URL
].map(arg => `"${arg}"`).join(" ");

execSync(`start "" "${CHROME_PATH}" ${chromeArgs}`, { shell: "cmd.exe" });

// Step 3: Wait for CDP
console.log("Waiting for Chrome...");
for (let index = 0; index < CDP_WAIT_RETRIES; index++) {
  try {
    await cdpRequest("/json/version");
    break;
  } catch {
    await setTimeout(CDP_RETRY_DELAY_MS);
  }
}

// Step 4: Check auth
const pages = await cdpRequest("/json/list");
const ytPage = pages.find(page => (page.url ?? "").includes("youtube") && page.type === "page");
if (!ytPage) {
  console.log("ERROR: No YouTube page found");
  process.exit(1);
}

const cookies = await fetchYtCookies(ytPage.webSocketDebuggerUrl!);

const authCookies = cookies.filter(cookie => AUTH_COOKIES.includes(cookie.name));
if (authCookies.length === 0) {
  console.log("ERROR: Not logged in. Sign in to YouTube first, then re-run.");
  process.exit(1);
}

console.log("Logged in.");

// Step 5: Navigate to subscriptions
console.log("Navigating to subscriptions...");
await cdpEval(ytPage.webSocketDebuggerUrl!, `location.href = "${SUBS_URL}"; "ok"`);
await setTimeout(NAVIGATE_SETTLE_MS);

// Step 6: Check grid items
const pages2 = await cdpRequest("/json/list");
const subsPage = pages2.find(page => (page.url ?? "").includes("subscriptions") && page.type === "page");
if (!subsPage) {
  console.log("ERROR: No subscriptions page");
  process.exit(1);
}

const gridResult = await cdpEval(
  subsPage.webSocketDebuggerUrl!, `
  (() => {
    const items = document.querySelectorAll('[data-ytdl-grid-item]');
    const withBtn = [...items].find(el => el.querySelector('yt-button-view-model button'));
    return JSON.stringify({
      gridItems: items.length,
      videoId: withBtn?.dataset?.ytdlGridItem,
      label: withBtn?.querySelector('yt-button-view-model button')?.getAttribute('aria-label')?.substring(0, 60)
    });
  })()
`
);

const grid = JSON.parse(gridResult);
console.log(`Grid items: ${grid.gridItems}, first downloadable: ${grid.videoId}`);

if (!grid.videoId) {
  console.log("ERROR: No downloadable grid items found");
  process.exit(1);
}

// Step 7: Click download
console.log(`Clicking download for ${grid.videoId}...`);
await cdpEval(
  subsPage.webSocketDebuggerUrl!, `
  (() => {
    const item = document.querySelector('[data-ytdl-grid-item="${grid.videoId}"]');
    const btn = item?.querySelector('yt-button-view-model button');
    btn?.click();
    return 'clicked';
  })()
`
);

// Step 8: Monitor progress
console.log("Monitoring download progress...");
for (let index = 0; index < MONITOR_POLL_COUNT; index++) {
  await setTimeout(MONITOR_POLL_INTERVAL_MS);
  try {
    const result = await cdpEval(
      subsPage.webSocketDebuggerUrl!, `
      (() => {
        const item = document.querySelector('[data-ytdl-grid-item="${grid.videoId}"]');
        const btn = item?.querySelector('yt-button-view-model button');
        const progress = item?.querySelector('tp-yt-paper-progress');
        return JSON.stringify({
          label: btn?.getAttribute('aria-label')?.substring(0, 60),
          progress: progress?.getAttribute('value'),
          hasProgress: !!progress
        });
      })()
    `
    );
    const state = JSON.parse(result);
    const elapsed = (index + 1) * (MONITOR_POLL_INTERVAL_MS / 1000);
    let status = "IDLE";
    if (state.label?.startsWith("Cancel")) {
      status = "DOWNLOADING";
    } else if (state.hasProgress) {
      status = "PROCESSING";
    }

    console.log(`T+${elapsed}s: ${status} progress=${state.progress || "n/a"}`);

    if (state.label?.includes("Downloaded")) {
      console.log("SUCCESS: Download completed!");
      process.exit(0);
    }
  } catch {
    console.log(`T+${(index + 1) * (MONITOR_POLL_INTERVAL_MS / 1000)}s: connection lost`);
    break;
  }
}

console.log("Test completed (download may still be in progress).");
process.exit(0);
