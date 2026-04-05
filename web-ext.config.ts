import { execSync } from "node:child_process";
import { readdirSync, existsSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";
import { defineWebExtConfig } from "wxt";

const { LANG = "en" } = process.env;
const osPlatform = process.platform;
const home = homedir();

const edgeByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  win32: join(process.env.ProgramFiles!, "Microsoft/Edge/Application/msedge.exe"),
  darwin: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  linux: "/usr/bin/microsoft-edge-stable"
};

const operaByPlatform: Partial<Record<NodeJS.Platform, string>> = {
  win32: join(process.env.LOCALAPPDATA!, "Programs/Opera/opera.exe"),
  darwin: "/Applications/Opera.app/Contents/MacOS/Opera",
  linux: "/usr/bin/opera"
};

function findDefaultFirefoxProfile() {
  const profilesDir = (() => {
    if (osPlatform === "win32") {
      return join(process.env.APPDATA!, "Mozilla/Firefox/Profiles");
    }

    if (osPlatform === "darwin") {
      return join(home, "Library/Application Support/Firefox/Profiles");
    }

    return join(home, ".mozilla/firefox");
  })();
  if (!existsSync(profilesDir)) {
    return undefined;
  }

  const profiles = readdirSync(profilesDir);
  const found = profiles.find(dir => dir.endsWith(".default-release")) ?? profiles.find(dir => dir.includes("default")) ?? profiles[0];
  if (found) {
    return join(profilesDir, found);
  }
}

const LOCK_FILES = new Set(["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket", "LOCK"]);

function setupChromeProfile() {
  const chromeSrcByPlatform: Partial<Record<NodeJS.Platform, string>> = {
    win32: join(process.env.LOCALAPPDATA!, "Google", "Chrome", "User Data"),
    darwin: join(home, "Library", "Application Support", "Google", "Chrome"),
    linux: join(home, ".config", "google-chrome")
  };
  const src = chromeSrcByPlatform[osPlatform];
  if (!src || !existsSync(src)) {
    return;
  }

  const dest = resolve(import.meta.dirname, "../User Data");
  if (existsSync(dest)) {
    return;
  }

  console.log(`Copying Chrome profile from ${src} to ${dest}...`);
  cpSync(src, dest, { recursive: true, filter: src => !LOCK_FILES.has(basename(src)) });
  console.log("Done.");
}

if (process.env.CHROME_WITH_PROFILE === "1") {
  setupChromeProfile();
}

// ─── Chrome lifecycle management ──────────────────────────────────────────────

// The WXT-managed Chrome is identified by --remote-debugging-port=9229.
// Kill it on startup (clears orphaned processes from previous crashes) and on
// exit (so Chrome always terminates with WXT).
function killWxtChrome() {
  try {
    if (osPlatform === "win32") {
      execSync(
        "powershell -NoProfile -Command \"$p=(Get-NetTCPConnection -LocalPort 9229 -EA SilentlyContinue|Select -First 1).OwningProcess;if($p){Stop-Process -Id $p -Force -EA SilentlyContinue}\"",
        { stdio: "ignore" }
      );
    } else {
      execSync("lsof -ti:9229 | xargs kill -9 2>/dev/null || true", { stdio: "ignore" });
    }
  } catch {
    // Ignore - Chrome may not be running
  }
}

// Only active during `wxt dev` - build commands don't launch a browser
const isDevRun = process.argv.some(arg => arg === "dev" || arg.endsWith("/dev"));
if (isDevRun) {
  killWxtChrome();
  process.on("exit", killWxtChrome);
}

// ─── Config ───────────────────────────────────────────────────────────────────

export default defineWebExtConfig({
  binaries: {
    edge: edgeByPlatform[osPlatform] ?? "",
    opera: operaByPlatform[osPlatform] ?? ""
  },
  startUrls: ["https://www.youtube.com/watch?v=wjggoT-3oVM&t=184s"],
  keepProfileChanges: true,
  ...process.env.CHROME_WITH_PROFILE === "1" && { chromiumProfile: resolve(import.meta.dirname, "../User Data") },
  firefoxArgs: ["-marionette", "-marionette-port", "2828", "--remote-debugging-port", "9225"],
  ...process.env.FIREFOX_WITH_PROFILE === "1" && { firefoxProfile: findDefaultFirefoxProfile() },
  chromiumArgs: [
    `--lang=${LANG}`,
    "--remote-debugging-port=9229",
    "--isolated",
    "--disable-blink-features=AutomationControlled",
    ...[process.env.CHROME_WITH_PROFILE === "1" ? "--profile-directory=Default" : ""]
  ]
});
