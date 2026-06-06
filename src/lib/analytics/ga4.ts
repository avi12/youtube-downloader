import { getOrCreateClientId } from "@/lib/storage/storage";

const GA4_MEASUREMENT_ID: string | undefined = import.meta.env.WXT_GA4_MEASUREMENT_ID;
const GA4_API_SECRET: string | undefined = import.meta.env.WXT_GA4_API_SECRET;
const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";
const UNINSTALL_BASE_URL = "https://avi12.github.io/youtube-downloader/uninstall";
const DAILY_HEARTBEAT_ALARM = "ytdlDailyHeartbeat";
const ENGAGEMENT_TIME_MSEC = 100;
const MICROSECONDS_PER_MILLISECOND = 1000;
const SESSION_ID = Date.now().toString();

interface GA4QueryParams {
  measurement_id: string;
  api_secret: string;
}

interface GA4EventParams {
  session_id: string;
  engagement_time_msec: number;
  browser: string;
  browser_version: string;
  os: string;
}

interface GA4Body {
  client_id: string;
  timestamp_micros: number;
  consent: {
    ad_user_data: "DENIED";
    ad_personalization: "DENIED";
  };
  events: {
    name: string;
    params: GA4EventParams;
  }[];
}

const BROWSER_PATTERNS: {
  regex: RegExp;
  browser: string;
}[] = [
  {
    regex: /Edg\/([\d.]+)/,
    browser: "Edge"
  },
  {
    regex: /OPR\/([\d.]+)/,
    browser: "Opera"
  },
  {
    regex: /Vivaldi\/([\d.]+)/,
    browser: "Vivaldi"
  },
  {
    regex: /Firefox\/([\d.]+)/,
    browser: "Firefox"
  },
  {
    regex: /Chrome\/([\d.]+)/,
    browser: "Chrome"
  }
];

type NavigatorWithBrave = Navigator & {
  brave: {
    isBrave(): Promise<boolean>;
  };
};

function isBraveNavigator(nav: Navigator): nav is NavigatorWithBrave {
  return "brave" in nav;
}

async function isBrave() {
  return isBraveNavigator(navigator) ? navigator.brave.isBrave() : false;
}

function matchBrowserFromUserAgent(userAgent: string) {
  for (const { regex, browser } of BROWSER_PATTERNS) {
    const version = userAgent.match(regex)?.[1];
    if (version) {
      return {
        browser,
        browser_version: version
      };
    }
  }

  return {
    browser: "unknown",
    browser_version: "unknown"
  };
}

async function detectBrowser(userAgent: string) {
  const matched = matchBrowserFromUserAgent(userAgent);
  if (matched.browser === "Chrome" && await isBrave()) {
    return {
      ...matched,
      browser: "Brave"
    };
  }

  return matched;
}

const OS_PATTERNS: {
  pattern: string;
  osName: string;
}[] = [
  {
    pattern: "Windows",
    osName: "Windows"
  },
  {
    pattern: "Mac",
    osName: "macOS"
  },
  {
    pattern: "Linux",
    osName: "Linux"
  }
];

function parseOs(userAgent: string) {
  return OS_PATTERNS.find(({ pattern }) => userAgent.includes(pattern))?.osName ?? "unknown";
}

async function getDeviceParams() {
  const userAgent = navigator.userAgent;
  return {
    ...await detectBrowser(userAgent),
    os: parseOs(userAgent)
  };
}

let developmentInstallPromise: Promise<boolean> | undefined;

async function isDevelopmentInstall() {
  developmentInstallPromise ??= browser.management
    .getSelf()
    .then(info => info.installType === browser.management.ExtensionInstallType.DEVELOPMENT)
    .catch(() => false);
  return developmentInstallPromise;
}

async function sendEvent(name: string) {
  if (!GA4_MEASUREMENT_ID || !GA4_API_SECRET || await isDevelopmentInstall()) {
    return;
  }

  const [clientId, deviceParams] = await Promise.all([getOrCreateClientId(), getDeviceParams()]);

  const urlSearchParams = new URLSearchParams({
    measurement_id: GA4_MEASUREMENT_ID,
    api_secret: GA4_API_SECRET
  } satisfies GA4QueryParams);
  await fetch(`${GA4_ENDPOINT}?${urlSearchParams}`, {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId,
      timestamp_micros: Date.now() * MICROSECONDS_PER_MILLISECOND,
      consent: {
        ad_user_data: "DENIED",
        ad_personalization: "DENIED"
      },
      events: [{
        name,
        params: {
          session_id: SESSION_ID,
          engagement_time_msec: ENGAGEMENT_TIME_MSEC,
          ...deviceParams
        }
      }]
    } satisfies GA4Body)
  }).catch(() => {});
}

export async function trackInstall() {
  await sendEvent("install");
}

export async function setUninstallUrl() {
  if (await isDevelopmentInstall()) {
    return;
  }

  const clientId = await getOrCreateClientId();
  await browser.runtime.setUninstallURL(`${UNINSTALL_BASE_URL}?client_id=${clientId}`);
}

const lastActiveDateItem = storage.defineItem<string | null>("local:ytdlLastActiveDate", { fallback: null });

async function maybeSendDailyActive() {
  const today = new Date().toISOString().slice(0, 10);
  const lastActiveDate = await lastActiveDateItem.getValue();
  if (lastActiveDate === today) {
    return;
  }

  await lastActiveDateItem.setValue(today);
  await sendEvent("daily_active");
}

async function handleDailyHeartbeat({ name }: Browser.alarms.Alarm) {
  if (name !== DAILY_HEARTBEAT_ALARM) {
    return;
  }

  await maybeSendDailyActive();
}

async function ensureDailyHeartbeatAlarm() {
  const existingAlarm = await browser.alarms.get(DAILY_HEARTBEAT_ALARM);
  if (existingAlarm) {
    return;
  }

  await browser.alarms.create(DAILY_HEARTBEAT_ALARM, { periodInMinutes: 24 * 60 });
}

export function registerDailyHeartbeat() {
  browser.alarms.onAlarm.addListener(handleDailyHeartbeat);
  ensureDailyHeartbeatAlarm().catch(() => {});
  maybeSendDailyActive().catch(() => {});
}
