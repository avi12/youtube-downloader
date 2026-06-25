import { registerChunkHandlers } from "./handlers/chunk-handlers";
import { registerDownloadHandlers } from "./handlers/download-handlers";
import { registerPipelineHandlers } from "./handlers/pipeline-handlers";
import { ensureProcessor } from "./handlers/processor";
import { registerStorageHandlers } from "./handlers/storage-handlers";
import { registerTabLifecycleHandlers } from "./handlers/tab-lifecycle";
import { registerRecentDownloadsRetention } from "./recent/recent-downloads";
import { trackInstall, registerDailyHeartbeat, setUninstallUrl } from "@/lib/analytics/ga4";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { initOffscreenPortListener } from "@/lib/messaging/offscreen-messaging";
import {
  clearLocalStorage,
  musicListItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { registerUpdateCheck } from "@/lib/updates/update-check";
import { onSabrBodyCaptured, startSabrRequestCapture } from "@/lib/youtube/sabr/request-capture";

export default defineBackground(() => {
  initOffscreenPortListener();
  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    // Best-effort push; the content script also pulls via GetCapturedSabrBody with
    // retry, so a missing receiver mid-reload is expected and must not crash the SW
    sendMessageToTab(MessageType.SabrBodyReady, undefined, tabId).catch(() => {});
  });

  registerChunkHandlers();
  registerDownloadHandlers();
  registerPipelineHandlers();
  registerRecentDownloadsRetention();
  registerStorageHandlers();
  registerTabLifecycleHandlers();

  registerDailyHeartbeat();
  registerUpdateCheck();

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason !== browser.runtime.OnInstalledReason.INSTALL) {
      return;
    }

    await clearLocalStorage();
    await trackInstall();
  });

  void Promise.all([
    statusProgressItem.setValue({}),
    videoQueueItem.setValue([]),
    musicListItem.setValue([]),
    videoOnlyListItem.setValue([]),
    videoDetailsItem.setValue({})
  ]);
  ensureProcessor().catch(() => {});
  void setUninstallUrl();
});
