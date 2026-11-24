import {
  CDP_PORT,
  IS_AUDIO_MUTED,
  IS_WSL,
  LANG,
  MARIONETTE_PORT,
  START_URL
} from "./options.ts";
import { OsPlatform } from "#scripts/dev/enums.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { resolve } from "node:path";
import webExtRun from "web-ext-run";

const REGISTRY_QUERY_TIMEOUT_MS = 3000;
// AppsUseLightTheme is 0 when Windows apps use the dark theme
const APPS_USE_DARK_THEME = "0x0";

// ── Chrome for Testing (branded Chrome 137+ removed --load-extension; CfT keeps it) ──

function detectWindowsDarkMode() {
  if (!IS_WSL) {
    return false;
  }

  const result = spawnSync(
    "reg.exe",
    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
    {
      encoding: "utf-8",
      timeout: REGISTRY_QUERY_TIMEOUT_MS
    }
  );
  if (result.status !== 0) {
    return false;
  }

  const match = result.stdout.match(/AppsUseLightTheme\s+REG_DWORD\s+(0x[01])/);
  return match?.[1] === APPS_USE_DARK_THEME;
}

const CFT_CACHE_DIR = resolve(PROJECT_ROOT, ".chrome-for-testing");

async function ensureChromeForTesting() {
  const { install, resolveBuildId, detectBrowserPlatform, Browser, computeExecutablePath } = await import("@puppeteer/browsers");
  const browserPlatform = detectBrowserPlatform();
  if (!browserPlatform) {
    throw new Error("Could not detect platform for Chrome for Testing");
  }

  const buildId = await resolveBuildId(Browser.CHROME, browserPlatform, "stable");
  const expectedPath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CFT_CACHE_DIR,
    platform: browserPlatform
  });
  if (existsSync(expectedPath)) {
    return expectedPath;
  }

  console.log(`Downloading Chrome for Testing (${browserPlatform}, build ${buildId})...`);
  const installed = await install({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CFT_CACHE_DIR,
    platform: browserPlatform
  });
  console.log(`Chrome for Testing installed at ${installed.executablePath}`);
  return installed.executablePath;
}

export interface BrowserLaunch {
  outputDir: string;
  profileDirectory: string;
}

export function launchFirefox({ outputDir, profileDirectory }: BrowserLaunch) {
  // Lets the dev server wake the suspended background event page over RDP (WebExtensionPolicy is
  // privileged), the way about:debugging's Inspect does - without touching a tab
  process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = "1";
  return webExtRun.cmd.run({
    target: "firefox-desktop",
    sourceDir: outputDir,
    startUrl: [START_URL],
    keepProfileChanges: true,
    firefoxProfile: profileDirectory,
    args: ["--marionette", `--remote-debugging-port=${CDP_PORT}`],
    pref: {
      "marionette.port": MARIONETTE_PORT,
      ...IS_AUDIO_MUTED ? { "media.volume_scale": "0.0" } : {}
    },
    noReload: true,
    noInput: true
  }, { shouldExitProgram: false });
}

// Branded Chrome on Linux is replaced by Chrome for Testing, with the flags the Multipass VM needs
async function resolveLinuxChromium() {
  if (platform() !== OsPlatform.Linux) {
    return {
      chromiumBinary: undefined,
      extraArgs: []
    };
  }

  return {
    chromiumBinary: await ensureChromeForTesting(),
    extraArgs: [
      ...detectWindowsDarkMode() ? ["--force-dark-mode", "--enable-features=WebContentsForceDark"] : [],
      "--disable-gpu",
      "--disable-software-rasterizer",
      // Ubuntu 24.04 AppArmor blocks Chrome's unprivileged userns sandbox even
      // with kernel.unprivileged_userns_clone=1. --no-sandbox is Chrome's own
      // documented workaround and is safe inside the disposable Multipass VM.
      "--no-sandbox"
    ]
  };
}

export async function launchChrome({ outputDir, profileDirectory }: BrowserLaunch) {
  const { chromiumBinary, extraArgs } = await resolveLinuxChromium();
  return webExtRun.cmd.run({
    target: "chromium",
    sourceDir: outputDir,
    startUrl: [START_URL],
    keepProfileChanges: true,
    chromiumProfile: profileDirectory,
    ...chromiumBinary ? { chromiumBinary } : {},
    args: [
      `--lang=${LANG}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--disable-blink-features=AutomationControlled",
      "--profile-directory=Profile 1",
      ...IS_AUDIO_MUTED ? ["--mute-audio"] : [],
      ...extraArgs
    ],
    noReload: true,
    noInput: true
  }, { shouldExitProgram: false });
}

export type WebExtRunner = Awaited<ReturnType<typeof launchChrome>>;
