/**
 * Dev server: WXT createServer + web-ext manages Chrome.
 * WXT dev client auto-rebuilds on file changes and reloads the extension.
 *
 * Usage: bun scripts/dev-server.ts
 */

import { createServer } from "wxt";
import { existsSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LANG = process.env.LANG ?? "en";
const START_URL = "https://www.youtube.com/feed/subscriptions";

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
  console.log(`Dev server at ${server.origin}`);
  console.log("File changes trigger auto-rebuild + extension reload.");
  console.log("Press Ctrl+C to stop.\n");

  const keepAlive = setInterval(() => {}, 30_000);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
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
