/**
 * Dev server: production builds + one long-lived browser with the extension sideloaded.
 *
 * Every change under src/ or to wxt.config.ts rebuilds, diffs the output against the previous build
 * (dev-output-changes.ts) and applies the smallest update that makes it live - the open YouTube tabs
 * are only navigated when nothing else can work:
 *   - extension pages only (popup, offscreen, mux worker): reload the open page or close the
 *     offscreen document; the extension and the tabs are untouched
 *   - background, ISOLATED content script, manifest: reload the extension and re-run the ISOLATED
 *     content scripts in the open tabs in place, so the page and the playing video survive
 *   - MAIN-world content script: reload the extension and the tabs it runs in - a script living in
 *     the page itself can't be torn down and run again
 * The browser stays open across every rebuild. Dev builds add the `scripting` permission so the
 * extension's background can re-inject its content scripts, plus the patches in dev-build-patches.ts.
 *
 * Usage:
 *   tsx scripts/dev-server.ts [--firefox] [--cdp-port <port>] [--marionette-port <port>]
 *                             [--profile-dir <dir>] [--out-dir <dir>] [--start-url <url>]
 * Each flag falls back to an env var (YTDL_DEV_CDP_PORT, YTDL_DEV_MARIONETTE_PORT, YTDL_DEV_PROFILE_DIR,
 * YTDL_DEV_OUT_DIR, YTDL_DEV_START_URL), so a second dev server can run beside the first on its own
 * debug port, profile and output dir.
 */

import { addRecorderContentScript, patchBuiltOutput } from "./dev-build-patches.ts";
import { createChromeReloadTarget } from "./dev-chrome.ts";
import { createFirefoxReloadTarget } from "./dev-firefox.ts";
import {
  planReload,
  readBuiltManifest,
  readGeckoId,
  ReloadKind,
  type ReloadPlan,
  takeBuildSnapshot
} from "./dev-output-changes.ts";
import { describeExtensionReload, describePageRefresh, type ReloadTarget } from "./dev-reload-actions.ts";
import chokidar from "chokidar";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir, platform } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve
} from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import webExtRun from "web-ext-run";
import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";
import { build } from "wxt";

const { values: cliOptions } = parseArgs({
  options: {
    firefox: {
      type: "boolean",
      default: false
    },
    "cdp-port": { type: "string" },
    "marionette-port": { type: "string" },
    "profile-dir": { type: "string" },
    "out-dir": { type: "string" },
    "start-url": { type: "string" }
  },
  allowPositionals: true
});

const IS_FIREFOX = cliOptions.firefox;
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
const IS_WSL = platform() === "linux" && !!process.env.WSL_DISTRO_NAME;
const PROFILE_PLATFORM_SUFFIX = IS_WSL ? "wsl" : platform();

const platformNodeModules = resolve(PROJECT_ROOT, `node_modules-${PROFILE_PLATFORM_SUFFIX}`);
if (existsSync(platformNodeModules)) {
  const existingNodePath = process.env.NODE_PATH ?? "";
  process.env.NODE_PATH = existingNodePath
    ? `${platformNodeModules}${process.platform === "win32" ? ";" : ":"}${existingNodePath}`
    : platformNodeModules;
}

const CDP_PORT_WINDOWS = 9229;
const CDP_PORT_LINUX = 9233;
const CDP_PORT_FIREFOX = 9230;
const MARIONETTE_PORT_DEFAULT = 2828;

function defaultCdpPort() {
  if (IS_FIREFOX) {
    return CDP_PORT_FIREFOX;
  }

  return platform() === "linux" ? CDP_PORT_LINUX : CDP_PORT_WINDOWS;
}

function parsePort({ rawPort, envName }: {
  rawPort: string;
  envName: string;
}) {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${envName} / flag value "${rawPort}" is not a port`);
  }

  return port;
}

function resolvePort({ flagValue, envName, fallback }: {
  flagValue?: string;
  envName: string;
  fallback: number;
}) {
  const rawPort = flagValue ?? process.env[envName];
  return rawPort === undefined
    ? fallback
    : parsePort({
      rawPort,
      envName
    });
}

const CDP_PORT = resolvePort({
  flagValue: cliOptions["cdp-port"],
  envName: "YTDL_DEV_CDP_PORT",
  fallback: defaultCdpPort()
});
const MARIONETTE_PORT = resolvePort({
  flagValue: cliOptions["marionette-port"],
  envName: "YTDL_DEV_MARIONETTE_PORT",
  fallback: MARIONETTE_PORT_DEFAULT
});
const DEFAULT_PROFILE_DIR = join(USER_PROFILES_DIR, IS_FIREFOX ? "firefox" : `chrome-${PROFILE_PLATFORM_SUFFIX}`);
const PROFILE_DIR = resolve(PROJECT_ROOT, cliOptions["profile-dir"] ?? process.env.YTDL_DEV_PROFILE_DIR ?? DEFAULT_PROFILE_DIR);
// WXT's outDir - the build lands in <outDir>/<browser>-mv3. Unset keeps WXT's own .output
const OUT_DIR = cliOptions["out-dir"] ?? process.env.YTDL_DEV_OUT_DIR;
const START_URL = cliOptions["start-url"] ?? process.env.YTDL_DEV_START_URL ?? "https://www.youtube.com/feed/subscriptions";
const { LANG = "en" } = process.env;
const REBUILD_DEBOUNCE_MS = 800;
const DEV_ONLY_PERMISSION = "scripting";

function logEvent(message: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

const SECONDS_FORMAT = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

function formatElapsed(startedAt: number) {
  return `${SECONDS_FORMAT.format((performance.now() - startedAt) / 1000)}s`;
}

// ── Chrome profile setup ────────────────────────────────────────────────────

function setupChromeProfile() {
  const sentinelPath = join(PROFILE_DIR, "Default", ".seeded");
  if (existsSync(sentinelPath)) {
    return PROFILE_DIR;
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
    mkdirSync(PROFILE_DIR, { recursive: true });
    return PROFILE_DIR;
  }

  console.log(`Setting up Chrome profile from ${source}...`);
  // Only Bookmarks: Preferences, Secure Preferences and Local State carry DPAPI-sealed fields that
  // send a cloned profile into decryption loops until Chrome exits
  for (const directory of ["Default", "Profile 1"]) {
    const bookmarksPath = join(source, directory, "Bookmarks");
    if (!existsSync(bookmarksPath)) {
      continue;
    }

    const destinationPath = join(PROFILE_DIR, directory, "Bookmarks");
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(bookmarksPath, destinationPath);
  }
  console.log("Profile setup complete.");

  mkdirSync(dirname(sentinelPath), { recursive: true });
  writeFileSync(sentinelPath, "");
  return PROFILE_DIR;
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

function setupFirefoxProfile() {
  const sentinelPath = join(PROFILE_DIR, ".seeded");
  if (existsSync(sentinelPath)) {
    return PROFILE_DIR;
  }

  mkdirSync(PROFILE_DIR, { recursive: true });

  const source = findDefaultFirefoxProfilePath();
  if (source && existsSync(source)) {
    console.log(`Setting up Firefox profile from ${source}...`);
    for (const file of FIREFOX_SESSION_FILES) {
      const sourcePath = join(source, file);
      if (!existsSync(sourcePath)) {
        continue;
      }

      cpSync(sourcePath, join(PROFILE_DIR, file));
    }
    console.log("Profile setup complete.");
  }

  writeFileSync(sentinelPath, "");
  return PROFILE_DIR;
}

// ── Leftover browser cleanup (only ever this dev server's own profile) ──────

function killExistingLinuxChromeInstances() {
  if (platform() !== "linux") {
    return;
  }

  spawnSync("pkill", ["-f", "[c]hrome-linux64"], {
    stdio: "ignore"
  });
}

function killExistingFirefoxInstances() {
  if (platform() !== "win32") {
    return;
  }

  const script = `
$profile = '${PROFILE_DIR.replace(/'/g, "''")}'
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

async function buildExtension() {
  let outputDir: string | undefined;
  await build({
    root: PROJECT_ROOT,
    browser: IS_FIREFOX ? "firefox" : "chrome",
    ...OUT_DIR ? { outDir: OUT_DIR } : {},
    // WXT merges these over wxt.config.ts's hooks by name, so they must stay on hooks the config
    // doesn't define - an inline build:publicAssets would silently drop its ffmpeg/LICENSE copies
    hooks: {
      "build:manifestGenerated"(_wxt, manifest) {
        manifest.permissions = [...new Set([...manifest.permissions ?? [], DEV_ONLY_PERMISSION])];
        manifest.content_scripts = addRecorderContentScript(manifest.content_scripts ?? []);
      },
      "build:done"(wxt) {
        outputDir = wxt.config.outDir;
        patchBuiltOutput(outputDir);
      }
    }
  });
  if (!outputDir) {
    throw new Error("WXT finished without reporting its output directory");
  }

  return outputDir;
}

// The browser serves extension files straight off the output dir and briefly holds them open
// without FILE_SHARE_DELETE, so a rebuild's cleanup can hit a transient Windows lock. Builds are
// idempotent, so retry those; anything else (a mid-edit syntax error) fails at once.
const TRANSIENT_FS_ERROR_PATTERN = /EPERM|EBUSY/;
const MAX_BUILD_ATTEMPTS = 3;
const BUILD_RETRY_DELAY_MS = 300;

function isRetryableBuildError({ error, attempt }: {
  error: unknown;
  attempt: number;
}) {
  return TRANSIENT_FS_ERROR_PATTERN.test(String(error)) && attempt < MAX_BUILD_ATTEMPTS;
}

async function buildWithLockRetry() {
  for (let attempt = 1; ; attempt++) {
    const outcome = await buildExtension().then(
      outputDir => ({ outputDir }),
      (error: unknown) => ({ error })
    );
    if ("outputDir" in outcome) {
      return outcome.outputDir;
    }

    if (!isRetryableBuildError({
      error: outcome.error,
      attempt
    })) {
      throw outcome.error;
    }

    logEvent(`Build hit a transient file lock (attempt ${attempt}/${MAX_BUILD_ATTEMPTS}) - retrying`);
    await delay(BUILD_RETRY_DELAY_MS);
  }
}

// ── Process diagnostics ─────────────────────────────────────────────────────

// WXT's in-process Vite server can reject with EBUSY when its watcher touches a file the browser
// holds locked; the build itself still succeeds. Anything else is logged and the session kept alive,
// so one transient browser hiccup never takes the dev server down.
function installProcessDiagnostics() {
  process.on("unhandledRejection", reason => {
    const isViteWatcherEbusy = reason instanceof Error && "code" in reason && reason.code === "EBUSY";
    if (isViteWatcherEbusy) {
      return;
    }

    logEvent("Unhandled rejection - dev server kept alive:");
    console.error(reason);
  });
  process.on("uncaughtException", error => {
    logEvent("Uncaught exception - dev server kept alive:");
    console.error(error);
  });
}

// ── Launch ──────────────────────────────────────────────────────────────────

// Suppress noisy web-ext-run logs
function quietWebExtLogs() {
  const WARN_LOG_LEVEL = 40;
  webExtConsoleStream.write = ({ level, msg: message }) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(message);
    }
  };
}

type BrowserLaunch = {
  outputDir: string;
  profileDirectory: string;
};

function launchFirefox({ outputDir, profileDirectory }: BrowserLaunch) {
  // Lets the dev server wake the suspended background event page over RDP (WebExtensionPolicy is
  // privileged), the way about:debugging's Inspect does - without touching a tab
  process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = "1";
  return webExtRun.cmd.run({
    target: "firefox-desktop",
    sourceDir: outputDir,
    startUrl: [START_URL],
    keepProfileChanges: true,
    firefoxProfile: profileDirectory,
    args: ["--marionette", `--remote-debugging-port=${CDP_PORT}`],
    pref: { "marionette.port": MARIONETTE_PORT },
    noReload: true,
    noInput: true
  }, { shouldExitProgram: false });
}

// Branded Chrome on Linux is replaced by Chrome for Testing, with the flags the Multipass VM needs
async function resolveLinuxChromium() {
  if (platform() !== "linux") {
    return {
      chromiumBinary: undefined,
      extraArgs: []
    };
  }

  return {
    chromiumBinary: await ensureChromeForTesting(),
    extraArgs: [
      ...detectWindowsDarkMode() ? ["--force-dark-mode", "--enable-features=WebContentsForceDark"] : [],
      "--disable-gpu",
      "--disable-software-rasterizer",
      // Ubuntu 24.04 AppArmor blocks Chrome's unprivileged userns sandbox even
      // with kernel.unprivileged_userns_clone=1. --no-sandbox is Chrome's own
      // documented workaround and is safe inside the disposable Multipass VM.
      "--no-sandbox"
    ]
  };
}

async function launchChrome({ outputDir, profileDirectory }: BrowserLaunch) {
  const { chromiumBinary, extraArgs } = await resolveLinuxChromium();
  return webExtRun.cmd.run({
    target: "chromium",
    sourceDir: outputDir,
    startUrl: [START_URL],
    keepProfileChanges: true,
    chromiumProfile: profileDirectory,
    ...chromiumBinary ? { chromiumBinary } : {},
    args: [
      `--lang=${LANG}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--disable-blink-features=AutomationControlled",
      "--profile-directory=Profile 1",
      ...extraArgs
    ],
    noReload: true,
    noInput: true
  }, { shouldExitProgram: false });
}

type WebExtRunner = Awaited<ReturnType<typeof launchChrome>>;

// ── Hot reload ──────────────────────────────────────────────────────────────

async function createReloadTarget({ runner, outputDir, profileDirectory }: BrowserLaunch & { runner: WebExtRunner }) {
  const builtManifest = readBuiltManifest(outputDir);
  function reloadExtensionOverRunner() {
    // web-ext-run ends its "Last extension reload" status line with \r, not a newline
    return runner.reloadAllExtensions().finally(() => process.stdout.write("\n"));
  }

  if (IS_FIREFOX) {
    return createFirefoxReloadTarget({
      profileDir: profileDirectory,
      extensionId: readGeckoId(builtManifest),
      reloadAddon: reloadExtensionOverRunner
    });
  }

  const chromeTarget = createChromeReloadTarget({
    cdpPort: CDP_PORT,
    extensionName: builtManifest.name ?? "",
    reloadExtensionOverPipe: reloadExtensionOverRunner
  });
  await chromeTarget.discoverExtension().then(
    extensionId => console.log(`Extension id: ${extensionId}`),
    (error: unknown) => console.warn(`Could not find the extension's service worker yet: ${String(error)}`)
  );
  return chromeTarget;
}

async function applyReloadPlan({ plan, reloadTarget }: {
  plan: ReloadPlan;
  reloadTarget: ReloadTarget;
}) {
  if (plan.kind === ReloadKind.None) {
    return "No output changes - skipped reload";
  }

  if (plan.kind === ReloadKind.RefreshPages) {
    return describePageRefresh({
      plan,
      refreshedPages: await reloadTarget.refreshPages(plan)
    });
  }

  return describeExtensionReload({
    plan,
    result: await reloadTarget.reloadExtension(plan)
  });
}

// Debounced rebuilds, one at a time: a change arriving mid-rebuild is parked and drained afterwards,
// so two builds never write the same output dir at once, and the output diff covers every edit made
// since the last applied build
function createRebuildLoop({ outputDir, reloadTarget }: {
  outputDir: string;
  reloadTarget: ReloadTarget;
}) {
  let lastSnapshot = takeBuildSnapshot(outputDir);
  let isRebuilding = false;
  let pendingChange: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  async function rebuildAndApply(changedPath: string) {
    const startedAt = performance.now();
    logEvent(`Change detected: ${relative(PROJECT_ROOT, changedPath)} - rebuilding`);
    try {
      await buildWithLockRetry();
    } catch (error) {
      logEvent("Rebuild failed - nothing reloaded, the next save retries:");
      console.error(error);
      return;
    }

    const nextSnapshot = takeBuildSnapshot(outputDir);
    const plan = planReload({
      before: lastSnapshot,
      after: nextSnapshot
    });
    try {
      const outcome = await applyReloadPlan({
        plan,
        reloadTarget
      });
      logEvent(`${outcome} (${formatElapsed(startedAt)})`);
      lastSnapshot = nextSnapshot;
    } catch (error) {
      // The diff baseline stays put, so the next save re-applies these changes too
      logEvent(`Update failed after rebuilding - the next save retries it, or reload the extension/tab by hand: ${String(error)}`);
    }
  }

  async function drainPending() {
    if (isRebuilding) {
      return;
    }

    isRebuilding = true;
    try {
      while (pendingChange !== null) {
        const changedPath = pendingChange;
        pendingChange = null;
        await rebuildAndApply(changedPath);
      }
    } finally {
      isRebuilding = false;
    }
  }

  return function scheduleRebuild(changedPath: string) {
    pendingChange = changedPath;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      drainPending().catch(error => console.error("Rebuild loop failed:", error));
    }, REBUILD_DEBOUNCE_MS);
  };
}

function watchSources(onChange: (changedPath: string) => void) {
  const STABILITY_THRESHOLD_MS = 150;
  const POLL_INTERVAL_MS = 50;
  const watcher = chokidar.watch(
    [join(PROJECT_ROOT, "src"), join(PROJECT_ROOT, "wxt.config.ts")],
    {
      ignoreInitial: true,
      // Atomic-write editors (VSCode/JetBrains) save via temp-file+rename; without this
      // chokidar fires `change` mid-write and the build reads stale/partial source.
      awaitWriteFinish: {
        stabilityThreshold: STABILITY_THRESHOLD_MS,
        pollInterval: POLL_INTERVAL_MS
      }
    }
  );
  watcher.on("all", (_event, changedPath) => onChange(changedPath));
  watcher.on("error", error => console.error("Watcher error:", error));
  return watcher;
}

// Closing the browser ends the dev server, and stopping the dev server closes the browser
function registerShutdown({ watcher, runner }: {
  watcher: ReturnType<typeof watchSources>;
  runner: WebExtRunner;
}) {
  let isExiting = false;
  async function exit() {
    if (isExiting) {
      return;
    }

    isExiting = true;
    await watcher.close().catch(() => {});
    await runner.exit().catch(() => {});
    process.exit(0);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      exit().catch(() => process.exit(1));
    });
  }

  runner.registerCleanup(() => {
    console.log("\nBrowser closed. Exiting.");
    exit().catch(() => process.exit(1));
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.chdir(PROJECT_ROOT);
  installProcessDiagnostics();

  if (IS_FIREFOX) {
    killExistingFirefoxInstances();
  } else {
    killExistingLinuxChromeInstances();
  }

  const browserName = IS_FIREFOX ? "Firefox" : "Chrome";
  const profileDirectory = IS_FIREFOX ? setupFirefoxProfile() : setupChromeProfile();

  console.log(`Building extension for ${browserName} (production)...`);
  const outputDir = await buildWithLockRetry();
  console.log(`Build complete: ${relative(PROJECT_ROOT, outputDir)}\n`);

  quietWebExtLogs();
  const browserLaunch = {
    outputDir,
    profileDirectory
  };
  const runner = await (IS_FIREFOX ? launchFirefox(browserLaunch) : launchChrome(browserLaunch));
  console.log(`${browserName} launched with extension sideloaded (debug port ${CDP_PORT}, profile ${relative(PROJECT_ROOT, profileDirectory)}).`);

  const reloadTarget = await createReloadTarget({
    ...browserLaunch,
    runner
  });
  const watcher = watchSources(createRebuildLoop({
    outputDir,
    reloadTarget
  }));
  console.log("Watching for file changes...\n");
  registerShutdown({
    watcher,
    runner
  });
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
