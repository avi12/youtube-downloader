/**
 * Dev server: WXT production builds (with inline source maps), sideloaded in
 * Chrome/Firefox via web-ext-run, hot-reloaded on src/ changes.
 *
 * On file change: rebuild → extension reload → YouTube tabs reloaded.
 * Chrome uses CDP (Page.reload over the debug-port WebSocket); Firefox uses
 * RDP (location.reload() via each tab's consoleActor) because Firefox's
 * Remote Agent on 9230 exposes WebSocket-only CDP with no /json endpoint.
 * On SIGINT/SIGTERM: web-ext-run kills the browser process.
 *
 * Source maps are gated by env var WXT_INLINE_SOURCEMAPS so `wxt build` for the
 * actual store release stays source-map-free.
 *
 * Must run via tsx (Node), not Bun — web-ext-run spawns Firefox and waits for
 * its randomly-assigned CDP port to start listening, which depends on Node's
 * child_process socket handling. Under Bun the wait resolves ECONNREFUSED
 * before Firefox binds the port, killing the launch.
 *
 * Usage:
 *   tsx dev.ts            - Chrome
 *   tsx dev.ts --firefox  - Firefox
 */

import { findFirefoxRdpPort, isFirefoxTab, isRecord, RDP } from "./firefox-rdp.js";
import chokidar from "chokidar";
import { execSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
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

// Prefer the forked Firefox under user-profiles/firefox-patched/ if it exists —
// see scripts/firefox-fork/README.md for how to build it. That build strips
// JS-detectable automation signals (Navigator.webdriver, any marionette/RDP
// leakage) while keeping the marionette port open for web-ext-run + MCP,
// which regular web-ext-run launch tripping YouTube's SABR anti-bot can't.
//
// An install without top-level omni.ja is unbootable (Firefox shows
// "The installation seems to be incomplete" and quits), so require both the
// binary AND omni.ja before picking the patched path.
function findFirefox() {
  const projectRoot = resolve(import.meta.dirname, "..");
  const patchedDir = resolve(projectRoot, "user-profiles", "firefox-patched");
  const patchedBinaries = [
    join(patchedDir, "firefox.exe"),
    join(patchedDir, "firefox")
  ];
  const omniPath = join(patchedDir, "omni.ja");
  for (const patchedBinary of patchedBinaries) {
    if (!existsSync(patchedBinary)) {
      continue;
    }

    if (!existsSync(omniPath)) {
      console.warn(`Skipping ${patchedBinary} — omni.ja missing (install incomplete). See scripts/firefox-fork/README.md.`);
      break;
    }

    console.log(`Using patched Firefox: ${patchedBinary}`);
    return patchedBinary;
  }

  if (platform() !== "win32") {
    return undefined;
  }

  const candidatePaths = [
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe"
  ];
  for (const candidatePath of candidatePaths) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

const IS_FIREFOX = process.argv.includes("--firefox");
// Firefox + marionette trips Google's automation detection, which silently
// blocks youtube.com sign-in. Pass --no-marionette when you need to sign
// into YouTube once in the dev profile; reopen without the flag afterwards
// and the cookies persist so the MCP session keeps working.
const FIREFOX_NO_MARIONETTE = process.argv.includes("--no-marionette");
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, IS_FIREFOX ? ".output/firefox-mv3" : ".output/chrome-mv3");
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
const CHROME_PROFILE_DIR = join(USER_PROFILES_DIR, "chrome");
const { LANG = "en" } = process.env;
const START_URL = "https://www.youtube.com/feed/subscriptions";
const CHROME_CDP_PORT = 9222;
const FIREFOX_CDP_PORT = 9230;
const REBUILD_DEBOUNCE_MS = 800;

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

// ── Chrome profile setup ────────────────────────────────────────────────────

const CHROME_PROFILE_SENTINEL = join(CHROME_PROFILE_DIR, "Default", ".seeded");

// Files needed for a CDP/MCP-driven debug session to be usable:
// - Local State (at User Data root) holds the DPAPI-sealed cookie encryption key
// - Default/Preferences + Secure Preferences: profile settings Chrome expects
// - Default/Bookmarks: nice-to-have for navigating
// - Default/Network/Cookies (+ related): login state for YouTube etc.
// - Login Data / History / Web Data: session continuity during debugging
// Everything else (Cache, Service Worker, Extensions, IndexedDB, ...) is intentionally
// skipped so Chrome starts lean.
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
  cpSync(sourcePath, destinationPath);
}

// Web-ext-run's CDP Extensions.loadUnpacked call requires developer mode to be
// enabled in the cloned profile. Cloned Preferences carry the original user's
// setting which may be off, so force it on before launch.
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

// ── Firefox profile setup ───────────────────────────────────────────────────

// Same principle as the Chrome allowlist: keep the clone lean so the
// firefox-devtools MCP attaches to a fresh-but-logged-in profile. Only session
// state is cloned — the host's prefs.js is intentionally omitted so
// web-ext-run's launch-time prefs (marionette + anti-BotGuard overrides)
// aren't shadowed by the host Firefox's preferences. We do write our own
// user.js to pin the extension's internal UUID (see `ensureFirefoxUserJs`).
const FIREFOX_SESSION_FILES = [
  "cookies.sqlite",          // logged-in session cookies
  "key4.db",                 // key store for encrypted logins
  "logins.json",             // saved passwords (paired with key4.db)
  "cert9.db",                // TLS certificate store
  "permissions.sqlite",      // per-site permissions
  "places.sqlite",           // history + bookmarks
  "favicons.sqlite"          // favicons (nice-to-have)
];

// Firefox assigns each MV3 extension a random UUID per-profile on first load,
// and `browser.identity.getRedirectURL()` bakes that UUID into the OAuth
// redirect URI. web-ext-run creates a fresh UUID on every sideload unless we
// pin it, which means Google rejects the redirect URI as unregistered.
//
// Pinning via `extensions.webextensions.uuids` (in user.js, which Firefox
// merges into prefs on startup) keeps the UUID stable across dev sessions.
// The resulting redirect URI must be added once to the OAuth client in the
// Google Cloud Console — see the console.log at launch for the exact value.
const FIREFOX_EXTENSION_ID = "youtube-downloader@avi12.com";
const FIREFOX_EXTENSION_UUID = "8e7a0b4f-5d2c-4e3b-9a1f-6c8d7e5f4a3b";

const FIREFOX_MARIONETTE_PORT = 2828;

function ensureFirefoxUserJs(profileDirectory: string) {
  const userJsPath = join(profileDirectory, "user.js");
  const uuidMap = JSON.stringify({ [FIREFOX_EXTENSION_ID]: FIREFOX_EXTENSION_UUID });
  // user_pref values must be valid JS strings, so the inner JSON gets escaped.
  // marionette.port pinned here (not via web-ext-run customPrefs, which Firefox
  // ignored for this pref). user.js is read at startup, before marionette binds.
  // remote.active-protocols=3 enables both CDP (bit 1) and BiDi (bit 2) on the
  // Remote Agent — modern Firefox defaults to BiDi only, which breaks tools
  // that speak CDP (e.g. the /json endpoint).
  //
  // navigator.webdriver is NOT pinned here. The dom.webdriver.enabled pref is a
  // deprecated no-op in modern Firefox — Navigator::Webdriver() reads
  // nsIMarionette.running directly, so launching with --marionette always
  // returns true at the XPCOM layer. The working override lives in
  // src/entrypoints/automation-spoof.content.ts (MAIN-world redefine at
  // document_start).
  const lines = [
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(uuidMap)});`,
    `user_pref("marionette.port", ${FIREFOX_MARIONETTE_PORT});`,
    `user_pref("remote.active-protocols", 3);`
  ].join("\n");
  writeFileSync(userJsPath, `${lines}\n`);
}

// Old user.js versions pinned theme prefs that then got persisted into prefs.js
// (where Firefox writes its runtime prefs on exit). Those stuck prefs lock the
// browser to a theme regardless of the OS theme, defeating live OS-theme
// following. Strip them on every launch so the profile behaves like a fresh
// install and reads from the OS.
const FIREFOX_THEME_PINS = [
  "ui.systemUsesDarkTheme",
  "browser.theme.content-theme",
  "browser.theme.toolbar-theme",
  "layout.css.prefers-color-scheme.content-override"
];

function stripFirefoxThemePins(profileDirectory: string) {
  const prefsPath = join(profileDirectory, "prefs.js");
  if (!existsSync(prefsPath)) {
    return;
  }

  const original = readFileSync(prefsPath, "utf-8");
  const lines = original.split(/\r?\n/);
  const kept = lines.filter(line => !FIREFOX_THEME_PINS.some(name => line.includes(`"${name}"`)));
  if (kept.length === lines.length) {
    return;
  }

  writeFileSync(prefsPath, kept.join("\n"));
  console.log(`Stripped ${lines.length - kept.length} pinned theme pref(s) from Firefox prefs.js`);
}

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

  // Modern Firefox records the active profile in [Install<hash>] with a
  // `Default=<relative path>` field. The per-profile `Default=1` flag is a
  // legacy fallback that can point at an abandoned profile (e.g. a bare
  // `default` alongside the real `default-release`), so prefer the install
  // block when it exists.
  const installMatch = ini.match(/^\[Install[0-9A-F]+\][\r\n]+(?:[^\r\n]*[\r\n]+)*?Default=(.+)$/m);
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

// Re-clone every launch (not gated on a sentinel) so changes the user makes
// in their regular Firefox — new cookies, new passwords, YouTube re-login —
// propagate into the dev profile on the next `pnpm ext:dev:firefox` without
// requiring a manual `rm -rf user-profiles/firefox`.
function setupFirefoxProfile() {
  mkdirSync(FIREFOX_PROFILE_DIR, { recursive: true });

  const source = findDefaultFirefoxProfilePath();
  if (source && existsSync(source)) {
    console.log(`Cloning Firefox profile from ${source}...`);
    for (const file of FIREFOX_SESSION_FILES) {
      cloneFile(join(source, file), join(FIREFOX_PROFILE_DIR, file));
    }
    console.log("Profile setup complete.");
  }

  stripFirefoxThemePins(FIREFOX_PROFILE_DIR);
  ensureFirefoxUserJs(FIREFOX_PROFILE_DIR);
  return FIREFOX_PROFILE_DIR;
}

// ── Dev-profile browser cleanup ─────────────────────────────────────────────

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

  for (const lockFile of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const lockPath = join(CHROME_PROFILE_DIR, lockFile);
    if (existsSync(lockPath)) {
      try {
        rmSync(lockPath, { force: true });
      } catch { /* held by OS, harmless */ }
    }
  }
}

function killExistingFirefoxInstances() {
  if (platform() !== "win32") {
    return;
  }

  const script = `
$profile = '${FIREFOX_PROFILE_DIR.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "name='firefox.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profile) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500
`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
    input: script,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 10_000
  });

  // Stale lock files prevent Firefox from starting against the cloned profile.
  for (const lockFile of ["parent.lock", ".parentlock", "lock"]) {
    const lockPath = join(FIREFOX_PROFILE_DIR, lockFile);
    if (existsSync(lockPath)) {
      try {
        rmSync(lockPath, { force: true });
      } catch { /* lock might be briefly held */ }
    }
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

async function buildExtension() {
  // Turns on `sourcemap: "inline"` inside wxt.config.ts's vite callback.
  process.env.WXT_INLINE_SOURCEMAPS = "1";
  await build({
    root: PROJECT_ROOT,
    browser: IS_FIREFOX ? "firefox" : "chrome",
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

// Firefox's CDP Remote Agent on port 9230 speaks WebSocket only — no /json
// HTTP endpoint — so the Chrome reload path doesn't work here. Use RDP on
// the dynamically-assigned port instead: listTabs → eval `location.reload()`
// via each tab's consoleActor. Fire-and-forget because the page reloads
// before any evaluationResult could be delivered.
const RELOAD_FLUSH_MS = 300;

async function reloadFirefoxYouTubeTabs() {
  const rdpPort = findFirefoxRdpPort();
  if (!rdpPort) {
    return;
  }

  const rdp = new RDP(rdpPort);
  try {
    await rdp.connect();
    const tabsResponse = await rdp.request("root", "listTabs");
    const tabs: unknown[] = Array.isArray(tabsResponse.tabs) ? tabsResponse.tabs : [];
    const youtubeTabs = tabs.filter(isFirefoxTab).filter(tab => tab.url?.includes("youtube.com"));

    for (const tab of youtubeTabs) {
      const targetResponse = await rdp.request(tab.actor, "getTarget");
      const frame = targetResponse.frame;
      if (!isRecord(frame) || typeof frame.consoleActor !== "string") {
        continue;
      }

      rdp.send(frame.consoleActor, "evaluateJSAsync", {
        text: "location.reload()",
        frameActor: null
      });
    }

    await new Promise(resolveFlush => setTimeout(resolveFlush, RELOAD_FLUSH_MS));
  } catch {
    /* RDP unreachable — skip reload */
  } finally {
    rdp.destroy();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

type WebExtRunner = Awaited<ReturnType<typeof webExtRun.cmd.run>>;

interface LogEntry {
  level: number;
  msg: string;
}

async function launchBrowser(profileDirectory: string): Promise<[WebExtRunner, () => Promise<void>]> {
  // Suppress noisy info-level web-ext-run logs; surface warn+
  const WARN_LOG_LEVEL = 40;
  webExtConsoleStream.write = ({ level, msg: message }: LogEntry) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(message);
    }
  };

  if (IS_FIREFOX) {
    // Probe for a free port starting at FIREFOX_CDP_PORT so running the sibling
    // youtube-downloader dev-server in parallel (which also defaults to 9230)
    // doesn't collide — whichever one comes up second just grabs the next port.
    const firefoxRemoteDebugPort = await findFreeTcpPort(FIREFOX_CDP_PORT);
    if (firefoxRemoteDebugPort !== FIREFOX_CDP_PORT) {
      console.log(`Firefox Remote Agent port ${FIREFOX_CDP_PORT} busy; using ${firefoxRemoteDebugPort} instead`);
    }

    // --no-marionette drops every automation-signalling flag (marionette AND
    // the CDP debug port) because Google's sign-in check shows "browser may
    // not be secure" whenever any of them is present. MCP can't attach in
    // that mode — it's a one-shot to sign into Google accounts, then rerun
    // without --no-marionette for normal dev.
    // Marionette port is forced via the `marionette.port` pref below since
    // --marionette-port= is ignored on some Firefox builds. 2829 keeps us out
    // of the way of sibling dev-server projects that default to 2828.
    // The firefox-devtools MCP connects via Marionette (port 2828) AND the
    // Remote Agent's WebDriver BiDi WebSocket (--remote-debugging-port). Both
    // protocols are programmatic — neither requires the visual F12 toolbox to
    // be open. The agent gets evaluate_script + navigate_page via Marionette,
    // and console/network events via BiDi, all without any DevTools UI.
    const firefoxArgs = FIREFOX_NO_MARIONETTE
      ? [`--lang=${LANG}`, "--allow-downgrade"]
      : [
        `--lang=${LANG}`,
        "--marionette",
        `--remote-debugging-port=${firefoxRemoteDebugPort}`,
        "--allow-downgrade"
      ];
    const runner = await webExtRun.cmd.run(
      {
        target: "firefox-desktop",
        sourceDir: OUTPUT_DIR,
        startUrl: [START_URL],
        keepProfileChanges: true,
        firefoxProfile: profileDirectory,
        firefox: findFirefox(),
        args: firefoxArgs,
        customPrefs: {
          "dom.webdriver.enabled": false,
          "marionette.log.level": "Fatal",
          "marionette.port": FIREFOX_MARIONETTE_PORT,
          "app.update.auto": false,
          "app.update.enabled": false,
          // Suppress visual DevTools restoration on profile reuse — agents access
          // devtools data via Marionette/BiDi protocols, never the F12 panel.
          "devtools.everOpened": false,
          "devtools.toolbox.host": "bottom",
          "devtools.command-button-tilt.enabled": false,
          // Enable WebDriver BiDi so console/network events are programmatically
          // available without opening DevTools.
          "remote.active-protocols": 3
        },
        noReload: true,
        noInput: true
      },
      { shouldExitProgram: false }
    );
    // Firefox reinjects content scripts on extension reload, but anything
    // the page itself cached (MAIN-world hooks, Polymer state, video
    // data scraped at page load) stays stale until we force a reload.
    return [runner, reloadFirefoxYouTubeTabs];
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
        `--remote-debugging-port=${CHROME_CDP_PORT}`,
        "--disable-blink-features=AutomationControlled"
      ],
      noReload: true,
      noInput: true
    },
    { shouldExitProgram: false }
  );
  return [runner, () => reloadChromeYouTubeTabs(CHROME_CDP_PORT)];
}

async function main() {
  process.chdir(PROJECT_ROOT);

  if (IS_FIREFOX) {
    process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = "1";
    killExistingFirefoxInstances();
  } else {
    killExistingChromeInstances();
  }

  const profileDirectory = IS_FIREFOX ? setupFirefoxProfile() : setupChromeProfile();

  console.log(`Building extension for ${IS_FIREFOX ? "Firefox" : "Chrome"} (production + inline source maps)...`);
  await buildExtension();
  console.log("Build complete.\n");

  const [runner, reloadYouTubeTabs] = await launchBrowser(profileDirectory);
  console.log(`${IS_FIREFOX ? "Firefox" : "Chrome"} launched with extension sideloaded.`);

  if (IS_FIREFOX) {
    console.log(
      "\nFirefox OAuth redirect URI (register this in Google Cloud Console):\n"
      + `  https://${FIREFOX_EXTENSION_UUID}.extensions.allizom.org/\n`
    );

    if (FIREFOX_NO_MARIONETTE) {
      console.log("Running without marionette — firefox-devtools MCP will NOT attach. Sign in to YouTube then re-run without --no-marionette.\n");
    }
  }

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

  function shutdown() {
    void watcher.close();
    void runner.exit();
    process.exit(0);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, shutdown);
  }

  // Keep alive until signal
  await new Promise(() => {});
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
