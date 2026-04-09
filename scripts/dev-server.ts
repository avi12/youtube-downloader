/**
 * Dev server: production builds (with source maps) + Chrome with sideloaded extension.
 * Uses ./User Data/Profile 1 for the Chrome profile.
 * On file changes: rebuilds for production and reloads extension + YouTube tabs.
 *
 * Chrome 126+ requires Extensions.loadUnpacked via CDP debug pipes.
 * web-ext-run (used by WXT internally) handles this via chrome-launcher.
 * Must run under Node (not Bun) because pipe fd mapping requires Node's spawn.
 *
 * Usage: npx tsx scripts/dev-server.ts
 */

import { build } from "wxt";
import chokidar from "chokidar";
import { debounce } from "perfect-debounce";
import { resolve, join, dirname } from "node:path";
import { existsSync, cpSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_DIR = resolve(PROJECT_ROOT, ".output/chrome-mv3");
const USER_DATA_DIR = resolve(PROJECT_ROOT, "User Data");
const PROFILE_NAME = "Profile 1";
const LANGUAGE = process.env.LANG ?? "en";
const START_URL = "https://www.youtube.com/feed/subscriptions";
const CDP_PORT = 9229;
const REBUILD_DEBOUNCE_MS = 800;

// ── Chrome profile setup ────────────────────────────────────────────────────

function setupDevProfile() {
  const profileDirectory = join(USER_DATA_DIR, PROFILE_NAME);
  if (existsSync(profileDirectory)) {
    return profileDirectory;
  }

  const home = homedir();
  const sourceUserData: Record<string, string> = {
    win32: join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data"),
    darwin: join(home, "Library", "Application Support", "Google", "Chrome"),
    linux: join(home, ".config", "google-chrome")
  };
  const source = sourceUserData[platform()];

  if (!source || !existsSync(source)) {
    mkdirSync(profileDirectory, { recursive: true });
    return profileDirectory;
  }

  console.log(`Setting up Chrome profile from ${source}...`);
  for (const directory of ["Default", PROFILE_NAME]) {
    const bookmarksPath = join(source, directory, "Bookmarks");
    if (!existsSync(bookmarksPath)) {
      continue;
    }
    const destinationPath = join(USER_DATA_DIR, directory, "Bookmarks");
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(bookmarksPath, destinationPath);
  }
  console.log("Profile setup complete.");

  return profileDirectory;
}

// ── Tab reload via HTTP CDP ─────────────────────────────────────────────────

async function reloadYouTubeTabs() {
  try {
    const pagesResponse = await fetch(`http://localhost:${CDP_PORT}/json`);
    const pages: Array<{ url: string; webSocketDebuggerUrl?: string }> =
      await pagesResponse.json();

    for (const page of pages) {
      if (!page.url?.includes("youtube.com") || !page.webSocketDebuggerUrl) {
        continue;
      }
      const websocket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise<void>(resolve => {
        websocket.onopen = () => {
          websocket.send(
            JSON.stringify({ id: 1, method: "Page.reload", params: {} })
          );
        };
        websocket.onmessage = e => {
          const data = JSON.parse(String(e.data));
          if (data.id === 1) {
            websocket.close();
            resolve();
          }
        };
        websocket.onerror = () => resolve();
      });
    }
  } catch {
    // CDP HTTP endpoint not available
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.chdir(PROJECT_ROOT);

  const profileDirectory = setupDevProfile();

  console.log("Building extension (production + source maps)...");
  await buildExtension();
  console.log("Build complete.\n");

  // Suppress noisy web-ext-run logs
  const WARN_LOG_LEVEL = 40;
  const webExtLogger = await import("web-ext-run/util/logger");
  webExtLogger.consoleStream.write = ({
    level,
    msg
  }: {
    level: number;
    msg: string;
    name: string;
  }) => {
    if (level >= WARN_LOG_LEVEL) {
      console.warn(msg);
    }
  };

  // Launch Chrome via web-ext-run (handles CDP pipes for extension loading)
  const webExtRun = await import("web-ext-run");
  const runner = await webExtRun.default.cmd.run(
    {
      target: "chromium",
      sourceDir: OUTPUT_DIR,
      startUrl: [START_URL],
      keepProfileChanges: true,
      chromiumProfile: profileDirectory,
      args: [
        `--lang=${LANGUAGE}`,
        `--remote-debugging-port=${CDP_PORT}`,
        "--disable-blink-features=AutomationControlled"
      ],
      noReload: true,
      noInput: true
    },
    { shouldExitProgram: false }
  );

  console.log("Chrome launched with extension sideloaded.");
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
      await reloadYouTubeTabs();
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
