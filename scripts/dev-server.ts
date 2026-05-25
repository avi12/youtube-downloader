/**
 * Dev server: production builds (with source maps) + browser with sideloaded extension.
 * On file changes: rebuilds for production and reloads extension + YouTube tabs.
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
import { debounce } from "perfect-debounce";
import webExtRun from "web-ext-run";
import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";

const IS_FIREFOX = process.argv.includes("--firefox");
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, IS_FIREFOX ? ".output/firefox-mv3" : ".output/chrome-mv3");
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
const IS_WSL = platform() === "linux" && !!process.env.WSL_DISTRO_NAME;
const PROFILE_PLATFORM_SUFFIX = IS_WSL ? "wsl" : platform();
const CHROME_PROFILE_DIR = join(USER_PROFILES_DIR, `chrome-${PROFILE_PLATFORM_SUFFIX}`);

const platformNodeModules = resolve(PROJECT_ROOT, `node_modules-${PROFILE_PLATFORM_SUFFIX}`);
if (existsSync(platformNodeModules)) {
  const existingNodePath = process.env.NODE_PATH ?? "";
  process.env.NODE_PATH = existingNodePath
    ? `${platformNodeModules}${process.platform === "win32" ? ";" : ":"}${existingNodePath}`
    : platformNodeModules;
}

const { LANG = "en" } = process.env;
const START_URL = "https://www.youtube.com/feed/subscriptions";
const CDP_PORT_WINDOWS = 9229;
const CDP_PORT_LINUX = 9233;
const CDP_PORT_FIREFOX = 9230;
const CDP_PORT = platform() === "linux" ? CDP_PORT_LINUX : CDP_PORT_WINDOWS;
const REBUILD_DEBOUNCE_MS = 800;
const BROWSER_POLL_INTERVAL_MS = 3_000;
const BROWSER_POLL_TIMEOUT_MS = 2_000;
const BROWSER_POLL_MAX_FAILURES = 3;

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

  mkdirSync(dirname(CHROME_PROFILE_SENTINEL), { recursive: true });
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

  // [Install<hash>] Default= is what Firefox actually launches; prefer it over Profile Default=1
  const installMatch = ini.match(/^\[Install[^\]]+][^[]*^Default=(.+)$/m);
  if (installMatch) {
    return join(firefoxDataPath, installMatch[1].trim());
  }

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

type CdpTarget = {
  type?: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

async function sendCdpMessage(websocketUrl: string, method: string, params: Record<string, unknown> = {}) {
  const websocket = new WebSocket(websocketUrl);
  await new Promise<void>(resolve => {
    websocket.onopen = () => {
      websocket.send(
        JSON.stringify({
          id: 1,
          method,
          params
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
    websocket.onclose = () => resolve();
  });
}

async function reloadBrowserAtPort(port: number) {
  let targets: CdpTarget[];
  try {
    const response = await fetch(`http://localhost:${port}/json`);
    targets = await response.json();
  } catch {
    return;
  }

  const extensionWorker = targets.find(target =>
    target.type === "service_worker" && target.url.startsWith("chrome-extension://"));
  if (extensionWorker?.webSocketDebuggerUrl) {
    await sendCdpMessage(extensionWorker.webSocketDebuggerUrl, "Runtime.evaluate", {
      expression: "chrome.runtime.reload()"
    });
  }

  const firefoxExtensionPage = targets.find(target => target.url?.startsWith("moz-extension://"));
  if (firefoxExtensionPage?.webSocketDebuggerUrl) {
    await sendCdpMessage(firefoxExtensionPage.webSocketDebuggerUrl, "Runtime.evaluate", {
      expression: "browser.runtime.reload()"
    });
  }

  const youtubeTabs = targets.filter(target =>
    target.url?.includes("youtube.com") && target.webSocketDebuggerUrl);
  for (const tab of youtubeTabs) {
    await sendCdpMessage(tab.webSocketDebuggerUrl!, "Runtime.evaluate", {
      expression: "location.reload()"
    });
  }
}

async function reloadYouTubeTabs() {
  await Promise.all([
    reloadBrowserAtPort(CDP_PORT_WINDOWS),
    reloadBrowserAtPort(CDP_PORT_LINUX),
    reloadBrowserAtPort(CDP_PORT_FIREFOX)
  ]);
}

// ── Chrome for Testing (branded Chrome 137+ removed --load-extension; CfT keeps it) ──

function detectWindowsDarkMode() {
  if (!IS_WSL) {
    return false;
  }

  const result = spawnSync(
    "reg.exe",
    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
    {
      encoding: "utf-8",
      timeout: 3000
    }
  );
  if (result.status !== 0) {
    return false;
  }

  const match = result.stdout.match(/AppsUseLightTheme\s+REG_DWORD\s+(0x[01])/);
  return match?.[1] === "0x0";
}

const CFT_CACHE_DIR = resolve(PROJECT_ROOT, ".chrome-for-testing");

async function ensureChromeForTesting() {
  const { install, resolveBuildId, detectBrowserPlatform, Browser, computeExecutablePath } = await import("@puppeteer/browsers");
  const browserPlatform = detectBrowserPlatform();
  if (!browserPlatform) {
    throw new Error("Could not detect platform for Chrome for Testing");
  }

  const buildId = await resolveBuildId(Browser.CHROME, browserPlatform, "stable");
  const expectedPath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CFT_CACHE_DIR,
    platform: browserPlatform
  });
  if (existsSync(expectedPath)) {
    return expectedPath;
  }

  console.log(`Downloading Chrome for Testing (${browserPlatform}, build ${buildId})...`);
  const installed = await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CFT_CACHE_DIR,
    platform: browserPlatform
  });
  console.log(`Chrome for Testing installed at ${installed.executablePath}`);
  return installed.executablePath;
}

// ── Build ───────────────────────────────────────────────────────────────────

const WXT_BIN = resolve(
  PROJECT_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wxt.cmd" : "wxt"
);

const TSX_BIN = resolve(
  PROJECT_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx"
);

function reloadFirefoxExtension() {
  const result = spawnSync(
    TSX_BIN,
    [join(PROJECT_ROOT, "scripts", "firefox-marionette-eval.ts"), "reload-ext", OUTPUT_DIR],
    {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "ignore", "inherit"],
      shell: true,
      timeout: 8000
    }
  );
  if (result.status !== 0) {
    console.warn("Firefox Marionette extension reload failed");
  }
}

const BUILD_TIMEOUT_MS = 120_000;

function buildExtension() {
  const result = spawnSync(WXT_BIN, ["build", ...(IS_FIREFOX ? ["--browser", "firefox"] : [])], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    shell: true,
    timeout: BUILD_TIMEOUT_MS
  });
  if (result.status !== 0) {
    throw new Error("Build failed");
  }
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

  const chromiumArgs: string[] = [
    `--lang=${LANG}`,
    `--remote-debugging-port=${CDP_PORT}`,
    "--disable-blink-features=AutomationControlled",
    "--profile-directory=Profile 1"
  ];
  let chromiumBinary: string | undefined;
  if (!IS_FIREFOX && platform() === "linux") {
    chromiumBinary = await ensureChromeForTesting();

    if (detectWindowsDarkMode()) {
      chromiumArgs.push("--force-dark-mode", "--enable-features=WebContentsForceDark");
    }

    chromiumArgs.push(
      "--disable-gpu",
      "--disable-software-rasterizer",
      // Ubuntu 24.04 AppArmor blocks Chrome's unprivileged userns sandbox even
      // with kernel.unprivileged_userns_clone=1. --no-sandbox is Chrome's own
      // documented workaround and is safe inside the disposable Multipass VM.
      "--no-sandbox"
    );
  }

  const runOptions = IS_FIREFOX
    ? {
      target: "firefox-desktop" as const,
      sourceDir: OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      firefoxProfile: profileDirectory,
      args: ["--marionette", "--remote-debugging-port=9230"],
      noReload: true,
      noInput: true
    }
    : {
      target: "chromium" as const,
      sourceDir: OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      chromiumProfile: profileDirectory,
      ...chromiumBinary && {
        chromiumBinary
      },
      args: chromiumArgs,
      noReload: true,
      noInput: true
    };

  const runner = await webExtRun.cmd.run(runOptions, {
    shouldExitProgram: false
  });

  console.log(`${IS_FIREFOX ? "Firefox" : "Chrome"} launched with extension sideloaded.`);

  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch(
    [join(PROJECT_ROOT, "src"), join(PROJECT_ROOT, "wxt.config.ts")],
    {
      ignoreInitial: true,
      usePolling: true,
      interval: 500
    }
  );

  let isRebuilding = false;

  const onFileChange = debounce(async (_event: string, filePath: string) => {
    if (isRebuilding) {
      return;
    }

    isRebuilding = true;
    console.log(`\nChange detected: ${filePath}`);
    console.log("Rebuilding...");
    try {
      buildExtension();

      if (IS_FIREFOX) {
        reloadFirefoxExtension();
      } else {
        await runner.reloadAllExtensions().catch(() => {});
      }

      await reloadYouTubeTabs();
      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    } finally {
      isRebuilding = false;
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));
  watcher.on("error", error => console.error("Watcher error:", error));

  let isExiting = false;
  async function exit() {
    if (isExiting) {
      return;
    }

    isExiting = true;
    try {
      await watcher.close();
    } catch { /* ignore */ }
    try {
      await runner.exit();
    } catch { /* ignore */ }
    process.exit(0);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void exit();
    });
  }

  const cdpPort = IS_FIREFOX ? CDP_PORT_FIREFOX : CDP_PORT;
  let browserPollFailures = 0;
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${cdpPort}/json`, {
        signal: AbortSignal.timeout(BROWSER_POLL_TIMEOUT_MS)
      });
      browserPollFailures = 0;
    } catch {
      if (++browserPollFailures >= BROWSER_POLL_MAX_FAILURES) {
        console.log("\nBrowser closed. Exiting.");
        void exit();
      }
    }
  }, BROWSER_POLL_INTERVAL_MS);

  // Keep process alive until exit
  await new Promise(() => {});
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
