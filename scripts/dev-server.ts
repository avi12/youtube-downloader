/**
 * Dev server: WXT createServer + web-ext manages Chrome.
 * Uses the default Chrome profile so the user is already signed in.
 * WXT dev client auto-rebuilds on file changes and reloads the extension.
 *
 * Usage: bun scripts/dev-server.ts
 */

import { createServer } from "wxt";
import { join, resolve } from "node:path";
import { platform } from "node:os";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LANG = process.env.LANG ?? "en";
const START_URL = "https://www.youtube.com/feed/subscriptions";

function getDefaultChromeProfile() {
  const platformPaths: Record<string, string> = {
    win32: join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data", "Default"),
    darwin: join(process.env.HOME ?? "", "Library", "Application Support", "Google", "Chrome", "Default"),
    linux: join(process.env.HOME ?? "", ".config", "google-chrome", "Default")
  };

  return platformPaths[platform()];
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
      chromiumProfile: getDefaultChromeProfile(),
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
