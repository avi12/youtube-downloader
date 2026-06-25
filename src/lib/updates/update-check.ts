import { updateAvailableVersionItem } from "@/lib/storage/storage";
import { z } from "@/lib/zod";

const UPDATE_CHECK_ALARM = "ytdlUpdateCheck";
const CHECK_PERIOD_MINUTES = 24 * 60;
const LATEST_RELEASE_API = "https://api.github.com/repos/avi12/youtube-downloader/releases/latest";
const TAG_VERSION_PREFIX = /^v/;
const BADGE_TEXT = "!";
const BADGE_COLOR = "#cc0000";

const latestReleaseSchema = z.object({
  tag_name: z.string()
});

function isNewerVersion(candidate: string, current: string) {
  return candidate.localeCompare(current, undefined, { numeric: true }) > 0;
}

async function fetchLatestVersion() {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) {
    return null;
  }

  const release = latestReleaseSchema.safeParse(await response.json());
  return release.success ? release.data.tag_name.replace(TAG_VERSION_PREFIX, "") : null;
}

async function applyAvailableUpdate(availableVersion: string | null) {
  const previousVersion = await updateAvailableVersionItem.getValue();
  if (availableVersion === previousVersion) {
    return;
  }

  await updateAvailableVersionItem.setValue(availableVersion);
  await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await browser.action.setBadgeText({ text: availableVersion ? BADGE_TEXT : "" });
}

async function checkForUpdate() {
  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) {
    return;
  }

  const currentVersion = browser.runtime.getManifest().version;
  await applyAvailableUpdate(isNewerVersion(latestVersion, currentVersion) ? latestVersion : null);
}

async function handleUpdateCheckAlarm({ name }: Browser.alarms.Alarm) {
  if (name !== UPDATE_CHECK_ALARM) {
    return;
  }

  await checkForUpdate();
}

async function ensureUpdateCheckAlarm() {
  const existingAlarm = await browser.alarms.get(UPDATE_CHECK_ALARM);
  if (existingAlarm) {
    return;
  }

  await browser.alarms.create(UPDATE_CHECK_ALARM, { periodInMinutes: CHECK_PERIOD_MINUTES });
}

// Firefox auto-applies self-hosted updates via browser_specific_settings.gecko.update_url,
// so the notifier is Chromium-only - there a self-signed .crx can't be sideloaded and users
// install a .zip via Load unpacked, which never auto-updates.
export function registerUpdateCheck() {
  if (import.meta.env.FIREFOX) {
    return;
  }

  browser.alarms.onAlarm.addListener(handleUpdateCheckAlarm);
  ensureUpdateCheckAlarm().catch(() => {});
  checkForUpdate().catch(() => {});
}
