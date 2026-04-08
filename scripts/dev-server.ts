/**
 * Dev server: WXT createServer + web-ext manages Chrome.
 * Copies the user's Chrome Default profile (Bookmarks only) so the dev
 * instance is signed in without locking the original profile.
 *
 * Usage: bun scripts/dev-server.ts
 */

import { createServer } from "wxt";
import { existsSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LANG = process.env.LANG ?? "en";
const START_URL = "https://www.youtube.com/feed/subscriptions";
const DEV_USER_DATA = resolve(PROJECT_ROOT, "..", "User Data");

function setupDevProfile() {
  const devProfile = join(DEV_USER_DATA, "Default");

  if (existsSync(devProfile)) {
    return devProfile;
  }

  const home = homedir();
  const sourceUserData: Record<string, string> = {
    win32: join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data"),
    darwin: join(home, "Library", "Application Support", "Google", "Chrome"),
    linux: join(home, ".config", "google-chrome")
  };
  const source = sourceUserData[platform()];

  if (!source || !existsSync(source)) {
    mkdirSync(devProfile, { recursive: true });
    return devProfile;
  }

  for (const profileDir of ["Default", "Profile 1"]) {
    const bookmarksPath = join(source, profileDir, "Bookmarks");
    if (!existsSync(bookmarksPath)) {
      continue;
    }

    const destPath = join(DEV_USER_DATA, profileDir, "Bookmarks");
    mkdirSync(dirname(destPath), { recursive: true });
    cpSync(bookmarksPath, destPath);
  }

  return devProfile;
}

async function main() {
  process.chdir(PROJECT_ROOT);

  const server = await createServer({
    root: PROJECT_ROOT,
    browser: "chrome",
    manifestVersion: 3,
    mode: "development",
    webExt: {
      startUrls: [START_URL],
      keepProfileChanges: true,
      chromiumProfile: setupDevProfile(),
      chromiumArgs: [
        `--lang=${LANG}`,
        "--remote-debugging-port=9229",
        "--disable-blink-features=AutomationControlled"
      ]
    }
  });

  await server.start();
  console.log(`Dev server at ${server.origin}`);
  console.log("File changes trigger auto-rebuild + extension reload.");
  console.log("Press Ctrl+C to stop.\n");

  // Node exits when the event loop is empty; this timer keeps the process alive
  const keepAliveIntervalMs = 30_000;
  const keepAlive = setInterval(() => {}, keepAliveIntervalMs);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      clearInterval(keepAlive);
      void server.stop();
      process.exit(0);
    });
  }
}

main().catch(error => {
  console.error("Fatal:", error);
  process.exit(1);
});
