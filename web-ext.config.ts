import { readdirSync, existsSync } from "node:fs";
import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
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

// Set up a Chrome profile with Bookmarks from the real profile.
// Session data (Cookies, Login Data) uses DPAPI encryption tied to the
// original profile path, so it can't be copied. The user signs in once
// and the session persists via keepProfileChanges.
function setupChromeProfile() {
  const chromeSrcByPlatform: Partial<Record<NodeJS.Platform, string>> = {
    win32: join(process.env.LOCALAPPDATA!, "Google", "Chrome", "User Data"),
    darwin: join(home, "Library", "Application Support", "Google", "Chrome"),
    linux: join(home, ".config", "google-chrome")
  };
  const src = chromeSrcByPlatform[osPlatform];
  if (!src || !existsSync(src)) {
    return undefined;
  }

  const dest = resolve(import.meta.dirname, "../User Data");
  if (existsSync(dest)) {
    return join(dest, "Default");
  }

  console.log(`Setting up Chrome profile from ${src}...`);
  for (const profileDir of ["Default", "Profile 1"]) {
    const srcFile = join(src, profileDir, "Bookmarks");
    if (!existsSync(srcFile)) {
      continue;
    }

    const destFile = join(dest, profileDir, "Bookmarks");
    mkdirSync(dirname(destFile), { recursive: true });
    cpSync(srcFile, destFile);
  }
  console.log("Done.");

  return join(dest, "Default");
}

// ─── Config ───────────────────────────────────────────────────────────────────

export default defineWebExtConfig({
  binaries: {
    edge: edgeByPlatform[osPlatform] ?? "",
    opera: operaByPlatform[osPlatform] ?? ""
  },
  startUrls: ["https://www.youtube.com/feed/subscriptions "],
  keepProfileChanges: true,
  ...process.env.CHROME_WITH_PROFILE === "1" && { chromiumProfile: setupChromeProfile() },
  firefoxArgs: ["-marionette", "-marionette-port", "2828", "--remote-debugging-port", "9225"],
  ...process.env.FIREFOX_WITH_PROFILE === "1" && { firefoxProfile: findDefaultFirefoxProfile() },
  chromiumArgs: [
    `--lang=${LANG}`,
    "--remote-debugging-port=9229",
    "--disable-blink-features=AutomationControlled"
  ]
});
