/**
 * Dev server: WXT createServer + web-ext manages Chrome.
 * WXT dev client keeps SW alive + registers content scripts.
 * File watcher auto-rebuilds + reloads.
 *
 * Usage: bun scripts/dev-server.ts
 */

import { createServer } from "wxt";
import { existsSync, cpSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LOG_FILE = join(PROJECT_ROOT, ".dev-server.log");
const LANG = process.env.LANG ?? "en";
const START_URL = "https://www.youtube.com/feed/subscriptions";

function log(...args: unknown[]) {
  const timestamp = new Date().toISOString().substring(11, 19);
  const message = `[${timestamp}] ${args.join(" ")}`;
  console.log(message);
  try { appendFileSync(LOG_FILE, `${message}\n`); } catch {
    // Logging is best-effort
  }
}

function setupChromeProfile() {
  const dest = resolve(PROJECT_ROOT, "..", "User Data");
  if (existsSync(dest)) {
    return join(dest, "Default");
  }

  const home = homedir();
  const platformPaths: Record<string, string> = {
    win32: join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data"),
    darwin: join(home, "Library", "Application Support", "Google", "Chrome"),
    linux: join(home, ".config", "google-chrome")
  };
  const src = platformPaths[process.platform];

  if (!src || !existsSync(src)) {
    mkdirSync(join(dest, "Default"), { recursive: true });
    return join(dest, "Default");
  }

  for (const dir of ["Default", "Profile 1"]) {
    const srcFile = join(src, dir, "Bookmarks");
    if (!existsSync(srcFile)) {
      continue;
    }

    const destFile = join(dest, dir, "Bookmarks");
    mkdirSync(dirname(destFile), { recursive: true });
    cpSync(srcFile, destFile);
  }

  return join(dest, "Default");
}

async function main() {
  process.chdir(PROJECT_ROOT);
  const chromiumProfile = setupChromeProfile();

  log("Starting WXT dev server...");
  const server = await createServer({
    root: PROJECT_ROOT,
    browser: "chrome",
    manifestVersion: 3,
    mode: "development",
    webExt: {
      startUrls: [START_URL],
      keepProfileChanges: true,
      chromiumProfile,
      chromiumArgs: [
        `--lang=${LANG}`,
        "--remote-debugging-port=9229",
        "--disable-blink-features=AutomationControlled"
      ]
    }
  });

  await server.start();
  log(`Dev server at ${server.origin}`);
  log("Press Ctrl+C to stop.\n");

  // Keep the process alive - WXT's server runs in the background
  // but bun may exit if the event loop appears empty.
  const keepAlive = setInterval(() => {}, 30_000);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      log("Shutting down...");
      clearInterval(keepAlive);
      await server.close().catch(() => {});
      process.exit(0);
    });
  }
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
