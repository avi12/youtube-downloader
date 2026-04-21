/**
 * Dev server: production builds (with source maps) + browser with sideloaded extension.
 * On file changes: rebuilds for production and reloads extension + YouTube tabs.
 *
 * Chrome 126+ requires Extensions.loadUnpacked via CDP debug pipes.
 * web-ext-run (used by WXT internally) handles this via chrome-launcher.
 * Must run under Node (not Bun) because pipe fd mapping requires Node's spawn.
 *
 * Usage:
 *   npx tsx scripts/dev-server.ts           - Chrome
 *   npx tsx scripts/dev-server.ts --firefox - Firefox
 */

import chokidar from "chokidar";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir, platform } from "node:os";
import { resolve, join, dirname } from "node:path";
import { firefox as playwrightFirefox } from "playwright-core";
import webExtRun from "web-ext-run";
import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";
import { build } from "wxt";

function debounce<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<void> | void, wait: number) {
  let timeoutId: NodeJS.Timeout | undefined;
  return (...args: TArgs) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => void fn(...args), wait);
  };
}

const IS_FIREFOX = process.argv.includes("--firefox");
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, IS_FIREFOX ? ".output/firefox-mv3" : ".output/chrome-mv3");
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
const CHROME_PROFILE_DIR = join(USER_PROFILES_DIR, "chrome");
const { LANG = "en" } = process.env;
const START_URL = "https://www.youtube.com/feed/subscriptions";
const CDP_PORT = 9229;
const REBUILD_DEBOUNCE_MS = 800;

// ── Chrome profile setup ────────────────────────────────────────────────────

const CHROME_PROFILE_SENTINEL = join(CHROME_PROFILE_DIR, "Default", ".seeded");

function setupChromeProfile() {
  if (existsSync(CHROME_PROFILE_SENTINEL)) {
    return CHROME_PROFILE_DIR;
  }

  const home = homedir();
  const { LOCALAPPDATA = "" } = process.env;
  const sourceUserData: Record<string, string> = {
    win32: join(LOCALAPPDATA, "Google", "Chrome", "User Data"),
    darwin: join(home, "Library", "Application Support", "Google", "Chrome"),
    linux: join(home, ".config", "google-chrome")
  };
  const source = sourceUserData[platform()];
  if (!source || !existsSync(source)) {
    mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
    return CHROME_PROFILE_DIR;
  }

  console.log(`Setting up Chrome profile from ${source}...`);
  for (const directory of ["Default", "Profile 1"]) {
    const bookmarksPath = join(source, directory, "Bookmarks");
    if (!existsSync(bookmarksPath)) {
      continue;
    }

    const destinationPath = join(CHROME_PROFILE_DIR, directory, "Bookmarks");
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(bookmarksPath, destinationPath);
  }
  console.log("Profile setup complete.");

  writeFileSync(CHROME_PROFILE_SENTINEL, "");
  return CHROME_PROFILE_DIR;
}

const FIREFOX_SESSION_FILES = [
  "cookies.sqlite",
  "key4.db",
  "logins.json",
  "cert9.db",
  "permissions.sqlite",
  "places.sqlite",
  "favicons.sqlite"
];

function findDefaultFirefoxProfilePath() {
  const home = homedir();
  const { APPDATA = "" } = process.env;
  const firefoxDataPaths: Record<string, string> = {
    win32: join(APPDATA, "Mozilla", "Firefox"),
    darwin: join(home, "Library", "Application Support", "Firefox"),
    linux: join(home, ".mozilla", "firefox")
  };
  const firefoxDataPath = firefoxDataPaths[platform()];
  const profilesIniPath = firefoxDataPath && join(firefoxDataPath, "profiles.ini");
  if (!profilesIniPath || !existsSync(profilesIniPath)) {
    return null;
  }

  const ini = readFileSync(profilesIniPath, "utf-8");
  const sections = ini.split(/(?=^\[Profile\d)/m);
  const defaultSection = sections.find(section => /^Default=1$/m.test(section));
  const pathMatch = defaultSection?.match(/^Path=(.+)$/m);
  const isRelative = /^IsRelative=1$/m.test(defaultSection ?? "");
  if (!pathMatch) {
    return null;
  }

  const profilePath = pathMatch[1].trim();
  return isRelative ? join(firefoxDataPath, profilePath) : profilePath;
}

const FIREFOX_PROFILE_DIR = join(USER_PROFILES_DIR, "firefox");
const FIREFOX_PROFILE_SENTINEL = join(FIREFOX_PROFILE_DIR, ".seeded");

function setupFirefoxProfile() {
  if (existsSync(FIREFOX_PROFILE_SENTINEL)) {
    return FIREFOX_PROFILE_DIR;
  }

  mkdirSync(FIREFOX_PROFILE_DIR, { recursive: true });

  const source = findDefaultFirefoxProfilePath();
  if (source && existsSync(source)) {
    console.log(`Setting up Firefox profile from ${source}...`);
    for (const file of FIREFOX_SESSION_FILES) {
      const sourcePath = join(source, file);
      if (!existsSync(sourcePath)) {
        continue;
      }

      cpSync(sourcePath, join(FIREFOX_PROFILE_DIR, file));
    }
    console.log("Profile setup complete.");
  }

  writeFileSync(FIREFOX_PROFILE_SENTINEL, "");
  return FIREFOX_PROFILE_DIR;
}

// ── Firefox cleanup ─────────────────────────────────────────────────────────

function killExistingFirefoxInstances() {
  if (platform() !== "win32") {
    return;
  }

  const script = `
$profile = '${FIREFOX_PROFILE_DIR.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "name='firefox.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    input: script,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 5000
  });
}

// ── Tab reload via HTTP CDP ─────────────────────────────────────────────────

async function reloadYouTubeTabs() {
  try {
    const pagesResponse = await fetch(`http://localhost:${CDP_PORT}/json`);
    const pages: Array<{
      url: string;
      webSocketDebuggerUrl?: string;
    }> =
      await pagesResponse.json();

    for (const page of pages) {
      if (!page.url?.includes("youtube.com") || !page.webSocketDebuggerUrl) {
        continue;
      }

      const websocket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise<void>(resolve => {
        websocket.onopen = () => {
          websocket.send(
            JSON.stringify({
              id: 1,
              method: "Page.reload",
              params: {}
            })
          );
        };
        websocket.onmessage = e => {
          const data: { id?: number } = JSON.parse(String(e.data));
          if (data.id === 1) {
            websocket.close();
            resolve();
          }
        };
        websocket.onerror = () => resolve();
      });
    }
  } catch {
    // CDP HTTP endpoint is not available
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

async function buildExtension() {
  await build({
    root: PROJECT_ROOT,
    browser: IS_FIREFOX ? "firefox" : "chrome",
    manifestVersion: 3
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.chdir(PROJECT_ROOT);

  if (IS_FIREFOX) {
    killExistingFirefoxInstances();
  }

  const profileDirectory = IS_FIREFOX ? setupFirefoxProfile() : setupChromeProfile();

  console.log(`Building extension for ${IS_FIREFOX ? "Firefox" : "Chrome"} (production + source maps)...`);
  await buildExtension();
  console.log("Build complete.\n");

  // Suppress noisy web-ext-run logs
  const WARN_LOG_LEVEL = 40;
  webExtConsoleStream.write = ({ level, msg: message }) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(message);
    }
  };

  const runOptions = IS_FIREFOX
    ? {
      target: "firefox-desktop" as const,
      sourceDir: OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      firefoxProfile: profileDirectory,
      // Use Playwright's Firefox Testing build: it's a stock Firefox with the
      // automation-detection fingerprints that YouTube's BotGuard checks
      // already patched out, but Marionette still works so firefox-devtools
      // MCP can attach.
      firefox: playwrightFirefox.executablePath(),
      // --marionette is needed so the firefox-devtools MCP can attach.
      // The pnpm patch on web-ext-run adds Firefox prefs (dom.webdriver.enabled=false,
      // remote.active-protocols=1, marionette.log.level=Fatal) that hide the
      // remaining JS-observable automation signals.
      args: [`--lang=${LANG}`, "--marionette", "--remote-debugging-port=9230"],
      noReload: true,
      noInput: true
    }
    : {
      target: "chromium" as const,
      sourceDir: OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      chromiumProfile: profileDirectory,
      args: [
        `--lang=${LANG}`,
        `--remote-debugging-port=${CDP_PORT}`,
        "--disable-blink-features=AutomationControlled"
      ],
      noReload: true,
      noInput: true
    };

  const runner = await webExtRun.cmd.run(runOptions, {
    shouldExitProgram: false
  });

  console.log(`${IS_FIREFOX ? "Firefox" : "Chrome"} launched with extension sideloaded.`);
  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch("src", {
    cwd: PROJECT_ROOT,
    ignoreInitial: true,
    usePolling: true,
    interval: 500
  });

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    console.log(`\nChange detected: ${filePath}`);
    console.log("Rebuilding...");
    try {
      await buildExtension();
      await runner.reloadAllExtensions();

      if (!IS_FIREFOX) {
        await reloadYouTubeTabs();
      }

      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void watcher.close();
      void runner.exit();
      process.exit(0);
    });
  }

  // Keep process alive until signal
  await new Promise(() => {});
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
