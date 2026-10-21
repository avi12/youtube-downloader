import { updateAvailableVersionItem } from "@/lib/storage/storage";
import { z } from "@/lib/zod";

const UPDATE_CHECK_ALARM = "ytdlUpdateCheck";
const CHECK_PERIOD_MINUTES = 24 * 60;
const RELEASES_API = "https://api.github.com/repos/avi12/youtube-downloader/releases?per_page=100";
const EXTENSION_TAG_PATTERN = /^v(\d+(?:\.\d+)*)$/;
const BADGE_TEXT = "!";
const BADGE_COLOR = "#cc0000";

const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean()
  })
);

function isNewerVersion(candidate: string, current: string) {
  return candidate.localeCompare(current, undefined, { numeric: true }) > 0;
}

// The repo also hosts other builds (e.g. ffmpeg-lite-v*), so only stable vX.Y.Z tags count
async function fetchLatestVersion() {
  const response = await fetch(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) {
    return null;
  }

  const releases = releasesSchema.safeParse(await response.json());
  if (!releases.success) {
    return null;
  }

  const versions = releases.data
    .filter(release => !release.draft && !release.prerelease)
    .flatMap(release => EXTENSION_TAG_PATTERN.exec(release.tag_name)?.[1] ?? []);
  return versions.reduce<string | null>(
    (latest, version) => (!latest || isNewerVersion(version, latest) ? version : latest),
    null
  );
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
// so the notifier is Chromium-only - there users drag in a .zip or .crx in Developer mode,
// which never auto-updates.
export function registerUpdateCheck() {
  if (import.meta.env.FIREFOX) {
    return;
  }

  browser.alarms.onAlarm.addListener(handleUpdateCheckAlarm);
  ensureUpdateCheckAlarm().catch(() => {});
  checkForUpdate().catch(() => {});
}
