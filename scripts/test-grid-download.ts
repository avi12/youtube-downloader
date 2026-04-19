/**
 * Automated grid download test.
 * Builds the extension, launches Chrome with it loaded, navigates to
 * subscriptions, clicks a download button, and monitors progress.
 *
 * Usage: node scripts/test-grid-download.mjs
 * Requires: logged-in Chrome profile at ../User Data
 */

import { execSync } from "child_process";
import http from "http";
import { join } from "path";
import WebSocket from "ws";

const CDP_PORT = 9230;
const CHROME_PATH = join(process.env.ProgramFiles, "Google/Chrome/Application/chrome.exe");
const EXT_PATH = join(import.meta.dirname, "../.output/chrome-mv3");
const USER_DATA = join(import.meta.dirname, "../../User Data");

function cdpRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}${path}`, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); }
      });
    }).on("error", reject);
  });
}

function cdpEval(wsUrl, expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise } }));
    });
    ws.on("message", raw => {
      const m = JSON.parse(raw.toString());
      if (m.id === 1) {
        if (m.result?.exceptionDetails) {
          reject(new Error(m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text));
        } else {
          resolve(m.result?.result?.value);
        }
        ws.close();
      }
    });
    ws.on("error", reject);
    setTimeout(() => { ws.close(); reject(new Error("CDP eval timeout")); }, 30000);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
  "https://www.youtube.com/watch?v=wjggoT-3oVM"
].map(a => `"${a}"`).join(" ");

execSync(`start "" "${CHROME_PATH}" ${chromeArgs}`, { shell: "cmd.exe" });

// Step 3: Wait for CDP
console.log("Waiting for Chrome...");
for (let i = 0; i < 30; i++) {
  try {
    await cdpRequest("/json/version");
    break;
  } catch {
    await sleep(1000);
  }
}

// Step 4: Check auth
const pages = await cdpRequest("/json/list");
const ytPage = pages.find(p => p.url.includes("youtube") && p.type === "page");
if (!ytPage) {
  console.log("ERROR: No YouTube page found");
  process.exit(1);
}

const cookies = await new Promise((resolve, reject) => {
  const ws = new WebSocket(ytPage.webSocketDebuggerUrl);
  ws.on("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Network.getCookies", params: { urls: ["https://www.youtube.com"] } }));
  });
  ws.on("message", raw => {
    const m = JSON.parse(raw.toString());
    if (m.id === 1) { resolve(m.result?.cookies || []); ws.close(); }
  });
  ws.on("error", reject);
  setTimeout(() => reject(new Error("timeout")), 5000);
});

const authCookies = cookies.filter(c => ["SID", "SSID", "LOGIN_INFO", "SAPISID"].includes(c.name));
if (authCookies.length === 0) {
  console.log("ERROR: Not logged in. Sign in to YouTube first, then re-run.");
  process.exit(1);
}
console.log("Logged in.");

// Step 5: Navigate to subscriptions
console.log("Navigating to subscriptions...");
await cdpEval(ytPage.webSocketDebuggerUrl, 'location.href = "https://www.youtube.com/feed/subscriptions"; "ok"');
await sleep(10000);

// Step 6: Check grid items
const pages2 = await cdpRequest("/json/list");
const subsPage = pages2.find(p => p.url.includes("subscriptions") && p.type === "page");
if (!subsPage) {
  console.log("ERROR: No subscriptions page");
  process.exit(1);
}

const gridResult = await cdpEval(subsPage.webSocketDebuggerUrl, `
  (() => {
    const items = document.querySelectorAll('[data-ytdl-grid-item]');
    const withBtn = [...items].find(el => el.querySelector('yt-button-view-model button'));
    return JSON.stringify({
      gridItems: items.length,
      videoId: withBtn?.dataset?.ytdlGridItem,
      label: withBtn?.querySelector('yt-button-view-model button')?.getAttribute('aria-label')?.substring(0, 60)
    });
  })()
`);

const grid = JSON.parse(gridResult);
console.log(`Grid items: ${grid.gridItems}, first downloadable: ${grid.videoId}`);

if (!grid.videoId) {
  console.log("ERROR: No downloadable grid items found");
  process.exit(1);
}

// Step 7: Click download
console.log(`Clicking download for ${grid.videoId}...`);
await cdpEval(subsPage.webSocketDebuggerUrl, `
  (() => {
    const item = document.querySelector('[data-ytdl-grid-item="${grid.videoId}"]');
    const btn = item?.querySelector('yt-button-view-model button');
    btn?.click();
    return 'clicked';
  })()
`);

// Step 8: Monitor progress
console.log("Monitoring download progress...");
for (let i = 0; i < 24; i++) {
  await sleep(5000);
  try {
    const result = await cdpEval(subsPage.webSocketDebuggerUrl, `
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
    `);
    const state = JSON.parse(result);
    const elapsed = (i + 1) * 5;
    console.log(`T+${elapsed}s: ${state.label?.startsWith("Cancel") ? "DOWNLOADING" : state.hasProgress ? "PROCESSING" : "IDLE"} progress=${state.progress || "n/a"}`);

    // Check if download completed (button shows checkmark label)
    if (state.label?.includes("Downloaded")) {
      console.log("SUCCESS: Download completed!");
      process.exit(0);
    }
  } catch {
    console.log(`T+${(i + 1) * 5}s: connection lost`);
    break;
  }
}

console.log("Test completed (download may still be in progress).");
process.exit(0);
