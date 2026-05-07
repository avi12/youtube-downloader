/**
 * Dev server: WXT production builds (with inline source maps), sideloaded in
 * Chrome via web-ext-run, hot-reloaded on src/ changes.
 *
 * On file change: rebuild → extension reload → YouTube tabs reloaded.
 * Chrome uses CDP (Page.reload over the debug-port WebSocket).
 * On SIGINT/SIGTERM: web-ext-run kills the browser process.
 *
 * Usage:
 *   tsx scripts/dev-server.ts
 */

import chokidar from "chokidar";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:net";
import { homedir, platform } from "node:os";
import { resolve, join, dirname } from "node:path";
import webExtRun from "web-ext-run";
import { consoleStream as webExtConsoleStream } from "web-ext-run/util/logger";
import { build } from "wxt";

function debounce<TArgs extends unknown[]>(callback: (...args: TArgs) => Promise<void> | void, wait: number) {
  let timeoutId: NodeJS.Timeout | undefined;
  return (...args: TArgs) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => void callback(...args), wait);
  };
}

async function findFreeTcpPort(startPort: number) {
  const MAX_PROBES = 50;
  for (let port = startPort; port < startPort + MAX_PROBES; port++) {
    const isAvailable = await new Promise<boolean>(resolvePromise => {
      const server = createServer();
      server.once("error", () => resolvePromise(false));
      server.once("listening", () => {
        server.close(() => resolvePromise(true));
      });
      server.listen(port, "127.0.0.1");
    });
    if (isAvailable) {
      return port;
    }
  }

  return startPort;
}

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, ".output/chrome-mv3");
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
const CHROME_PROFILE_DIR = join(USER_PROFILES_DIR, "chrome");
const { LANG = "en" } = process.env;
const START_URL = "https://www.youtube.com/feed/subscriptions";
const CHROME_CDP_START_PORT = 9222;
const REBUILD_DEBOUNCE_MS = 800;

// ── Chrome profile setup ────────────────────────────────────────────────────

const CHROME_PROFILE_SENTINEL = join(CHROME_PROFILE_DIR, "Default", ".seeded");

const CHROME_USERDATA_FILES = ["Local State"];
const CHROME_DEFAULT_FILES = [
  "Preferences",
  "Secure Preferences",
  "Bookmarks",
  "Login Data",
  "Login Data For Account",
  "History",
  "Favicons",
  "Web Data",
  "Top Sites"
];
const CHROME_DEFAULT_NETWORK_FILES = ["Cookies", "Network Persistent State", "TransportSecurity"];

function cloneFile(sourcePath: string, destinationPath: string) {
  if (!existsSync(sourcePath)) {
    return;
  }

  mkdirSync(dirname(destinationPath), { recursive: true });
  try {
    cpSync(sourcePath, destinationPath);
  } catch {
    // Destination may be locked — skip; existing file is fine
  }
}

function ensureChromeDeveloperMode() {
  const preferencesPath = join(CHROME_PROFILE_DIR, "Default", "Preferences");
  mkdirSync(dirname(preferencesPath), { recursive: true });
  const preferences = existsSync(preferencesPath) ? JSON.parse(readFileSync(preferencesPath, "utf-8")) : {};
  preferences.extensions = {
    ...preferences.extensions,
    ui: {
      ...preferences.extensions?.ui,
      developer_mode: true
    }
  };
  delete preferences.protection;
  writeFileSync(preferencesPath, JSON.stringify(preferences));
}

function setupChromeProfile() {
  if (existsSync(CHROME_PROFILE_SENTINEL)) {
    ensureChromeDeveloperMode();
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
  const sourceDefault = source && join(source, "Default");
  if (!sourceDefault || !existsSync(sourceDefault)) {
    mkdirSync(join(CHROME_PROFILE_DIR, "Default"), { recursive: true });
    writeFileSync(CHROME_PROFILE_SENTINEL, "");
    return CHROME_PROFILE_DIR;
  }

  console.log(`Cloning Chrome Default profile from ${sourceDefault}...`);

  for (const file of CHROME_USERDATA_FILES) {
    cloneFile(join(source, file), join(CHROME_PROFILE_DIR, file));
  }

  const destinationDefault = join(CHROME_PROFILE_DIR, "Default");
  for (const file of CHROME_DEFAULT_FILES) {
    cloneFile(join(sourceDefault, file), join(destinationDefault, file));
  }

  for (const file of CHROME_DEFAULT_NETWORK_FILES) {
    cloneFile(join(sourceDefault, "Network", file), join(destinationDefault, "Network", file));
  }

  ensureChromeDeveloperMode();
  console.log("Profile setup complete.");

  writeFileSync(CHROME_PROFILE_SENTINEL, "");
  return CHROME_PROFILE_DIR;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

function killExistingDevServers() {
  if (platform() !== "win32") {
    return;
  }

  const script = `
$selfStart = (Get-Process -Id ${process.pid}).StartTime
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains('dev-server') } |
  ForEach-Object {
    try {
      $proc = Get-Process -Id $_.ProcessId -ErrorAction Stop
      if ($proc.StartTime -lt $selfStart) {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
Start-Sleep -Milliseconds 500
`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    input: script,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 10_000
  });
}

function killExistingChromeInstances() {
  if (platform() !== "win32") {
    return;
  }

  const script = `
$profile = '${CHROME_PROFILE_DIR.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "name='chrome.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    input: script,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 10_000
  });

  for (const lockFile of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const lockPath = join(CHROME_PROFILE_DIR, lockFile);
    if (existsSync(lockPath)) {
      try {
        rmSync(lockPath, { force: true });
      } catch { /* lock might be briefly held */ }
    }
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

async function buildExtension() {
  await build({
    root: PROJECT_ROOT,
    browser: "chrome",
    manifestVersion: 3
  });
}

async function reloadChromeYouTubeTabs(cdpPort: number) {
  let tabs: Array<{
    url?: string;
    webSocketDebuggerUrl?: string;
  }>;
  try {
    const response = await fetch(`http://localhost:${cdpPort}/json`);
    tabs = await response.json();
  } catch {
    return;
  }

  const youtubeTabs = tabs.filter(tab => tab.url?.includes("youtube.com") && tab.webSocketDebuggerUrl);
  await Promise.all(
    youtubeTabs.map(tab => new Promise<void>(resolve => {
      const ws = new WebSocket(tab.webSocketDebuggerUrl!);
      function done() {
        ws.close();
        resolve();
      }
      ws.addEventListener("open", () => ws.send(
        JSON.stringify({
          id: 1,
          method: "Page.reload"
        })
      ));
      ws.addEventListener("message", done);
      ws.addEventListener("error", done);
      setTimeout(done, 3000);
    }))
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

type WebExtRunner = Awaited<ReturnType<typeof webExtRun.cmd.run>>;

interface LogEntry {
  level: number;
  msg: string;
}

async function launchBrowser(profileDirectory: string): Promise<[WebExtRunner, () => Promise<void>]> {
  const WARN_LOG_LEVEL = 40;
  webExtConsoleStream.write = ({ level, msg: message }: LogEntry) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(message);
    }
  };

  const cdpPort = await findFreeTcpPort(CHROME_CDP_START_PORT);
  if (cdpPort !== CHROME_CDP_START_PORT) {
    console.log(`Chrome CDP port ${CHROME_CDP_START_PORT} busy; using ${cdpPort} instead`);
  }

  const runner = await webExtRun.cmd.run(
    {
      target: "chromium",
      sourceDir: OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      chromiumProfile: profileDirectory,
      args: [
        `--lang=${LANG}`,
        `--remote-debugging-port=${cdpPort}`,
        "--disable-blink-features=AutomationControlled"
      ],
      noReload: true,
      noInput: true
    },
    { shouldExitProgram: false }
  );
  return [runner, () => reloadChromeYouTubeTabs(cdpPort)];
}

async function main() {
  process.chdir(PROJECT_ROOT);

  killExistingDevServers();
  killExistingChromeInstances();

  const profileDirectory = setupChromeProfile();

  console.log("Building extension for Chrome (production + inline source maps)...");
  await buildExtension();
  console.log("Build complete.\n");

  const [runner, reloadYouTubeTabs] = await launchBrowser(profileDirectory);
  console.log("Chrome launched with extension sideloaded.");
  console.log("Watching for file changes...\n");

  const watcher = chokidar.watch(["src", "wxt.config.ts"], {
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
      await reloadYouTubeTabs();

      console.log(`Reloaded at ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error("Rebuild failed:", error);
    }
  }, REBUILD_DEBOUNCE_MS);

  watcher.on("all", (event, filePath) => onFileChange(event, filePath));

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    try {
      await watcher.close();
    } catch { /* watcher may already be closed */ }
    try {
      await runner.exit();
    } catch { /* runner may already be exiting */ }

    killExistingChromeInstances();
    process.exit(0);
  }

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    process.on(signal, () => void shutdown());
  }

  const parentPid = process.ppid;
  if (parentPid > 0) {
    const ORPHAN_PROBE_INTERVAL_MS = 2_000;
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        void shutdown();
      }
    }, ORPHAN_PROBE_INTERVAL_MS).unref();
  }

  await new Promise(() => {});
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
