// The dev browser's own profile, seeded once from the user's, and cleanup of a leftover instance on it
import { BuildBrowser, OsPlatform } from "#scripts/dev/enums.ts";
import { PROFILE_DIR, REQUEST_TIMEOUT_MS } from "./options.ts";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

// ── Chrome profile setup ────────────────────────────────────────────────────

export function setupChromeProfile() {
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
    linux: join(home, ".mozilla", BuildBrowser.Firefox)
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

export function setupFirefoxProfile() {
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

export function killExistingLinuxChromeInstances() {
  if (platform() !== OsPlatform.Linux) {
    return;
  }

  spawnSync("pkill", ["-f", "[c]hrome-linux64"], {
    stdio: "ignore"
  });
}

export function killExistingFirefoxInstances() {
  if (platform() !== OsPlatform.Windows) {
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
    timeout: REQUEST_TIMEOUT_MS
  });
}
