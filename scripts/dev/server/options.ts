// The dev server's command line: each flag falls back to a YTDL_DEV_* env var, so a second instance can run side by side
import { BuildBrowser, OsPlatform } from "#scripts/dev/enums.ts";
import { PROJECT_ROOT } from "#scripts/dev/project.ts";
import { platform } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ENV_FLAG_ON = "1";

export const REQUEST_TIMEOUT_MS = 5000;

const { values: cliOptions } = parseArgs({
  options: {
    firefox: {
      type: "boolean",
      default: false
    },
    "cdp-port": {
       type: "string" 
    },
    "marionette-port": {
       type: "string" 
    },
    "profile-dir": {
       type: "string" 
    },
    "out-dir": {
       type: "string" 
    },
    "start-url": {
       type: "string" 
    },
    "mute-audio": {
      type: "boolean",
      default: false
    }
  },
  allowPositionals: true
});

export const IS_FIREFOX = cliOptions.firefox;
// For test instances launched beside a real session, so a video under test stays silent
export const IS_AUDIO_MUTED = cliOptions["mute-audio"] || process.env.YTDL_DEV_MUTE_AUDIO === ENV_FLAG_ON;
const USER_PROFILES_DIR = resolve(PROJECT_ROOT, "user-profiles");
export const IS_WSL = platform() === OsPlatform.Linux && !!process.env.WSL_DISTRO_NAME;
export const PROFILE_PLATFORM_SUFFIX = IS_WSL ? "wsl" : platform();

const CDP_PORT_WINDOWS = 9229;
const CDP_PORT_LINUX = 9233;
const CDP_PORT_FIREFOX = 9230;
const MARIONETTE_PORT_DEFAULT = 2828;

function defaultCdpPort() {
  if (IS_FIREFOX) {
    return CDP_PORT_FIREFOX;
  }

  return platform() === OsPlatform.Linux ? CDP_PORT_LINUX : CDP_PORT_WINDOWS;
}

function parsePort({ rawPort, envName }: {
  rawPort: string;
  envName: string;
}) {
  const port = Number(rawPort);
  const isInvalidPort = !Number.isInteger(port) || port <= 0;
  if (isInvalidPort) {
    throw new Error(`${envName} / flag value "${rawPort}" is not a port`);
  }

  return port;
}

function resolvePort({ flagValue, envName, fallback }: {
  flagValue?: string;
  envName: string;
  fallback: number;
}) {
  const rawPort = flagValue ?? process.env[envName];
  return rawPort === undefined
    ? fallback
    : parsePort({
      rawPort,
      envName
    });
}

export const CDP_PORT = resolvePort({
  flagValue: cliOptions["cdp-port"],
  envName: "YTDL_DEV_CDP_PORT",
  fallback: defaultCdpPort()
});
export const MARIONETTE_PORT = resolvePort({
  flagValue: cliOptions["marionette-port"],
  envName: "YTDL_DEV_MARIONETTE_PORT",
  fallback: MARIONETTE_PORT_DEFAULT
});
const DEFAULT_PROFILE_DIR = join(USER_PROFILES_DIR, IS_FIREFOX ? BuildBrowser.Firefox : `${BuildBrowser.Chrome}-${PROFILE_PLATFORM_SUFFIX}`);
export const PROFILE_DIR = resolve(PROJECT_ROOT, cliOptions["profile-dir"] ?? process.env.YTDL_DEV_PROFILE_DIR ?? DEFAULT_PROFILE_DIR);
// WXT's outDir - the build lands in <outDir>/<browser>-mv3. Unset keeps WXT's own .output
export const OUT_DIR = cliOptions["out-dir"] ?? process.env.YTDL_DEV_OUT_DIR;
export const START_URL = cliOptions["start-url"] ?? process.env.YTDL_DEV_START_URL ?? "https://www.youtube.com/feed/subscriptions";
export const { LANG = "en" } = process.env;
export const REBUILD_DEBOUNCE_MS = 800;
export const WATCH_POLL_INTERVAL_MS = 500;
export const HMR_PORT_OFFSET = 1000;
export const ENV_FILES = [".env", ".env.local"];
export const INSTALL_MARKER_PATH = "node_modules/.modules.yaml";
export const INSTALLED_LOCKFILE_PATH = join(PROJECT_ROOT, "node_modules", ".pnpm", "lock.yaml");
export const DEV_ONLY_PERMISSION = "scripting";
