import { resolvePrimerCapture } from "./download/primer-capture";
import { registerChunkHandlers, registerStorageHandlers } from "./handlers/chunk-and-storage-handlers";
import { registerDownloadHandlers } from "./handlers/download-handlers";
import { registerPipelineHandlers } from "./handlers/pipeline-handlers";
import { ensureProcessor } from "./handlers/processor";
import { registerTabLifecycleHandlers } from "./handlers/tab-lifecycle";
import { registerSabrOriginRule } from "./network/declarative-net-request";
import { registerRecentDownloadsRetention } from "./recent/recent-downloads-retention";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import {
  clearLocalStorage,
  musicListItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { onSabrBodyCaptured, startSabrRequestCapture } from "@/lib/youtube/sabr/request-capture";

let bgStartCount = 0;
export default defineBackground(() => {
  bgStartCount++;
  void broadcastDebugLogToYouTubeTabs(`[ytdl:bg] background started (count=${bgStartCount})`);
  registerSabrOriginRule().catch(error => console.error("[ytdl:bg] registerSabrOriginRule failed:", error));

  onMessage(MessageType.BgDebugLog, async ({ data }) => {
    const tabs = await browser.tabs.query({ url: "https://www.youtube.com/*" });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void sendMessage(MessageType.BgDebugLog, data, tab.id);
      }
    }
  });

  void startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    void sendMessage(MessageType.SabrBodyReady, {}, tabId);
  });

  onMessage(MessageType.SabrTemplateReady, ({ data }) => {
    if (data.factoryId?.startsWith("sabr-primer-")) {
      resolvePrimerCapture(data.factoryId, data.url, data.bodyBase64);
    }
  });

  void statusProgressItem.setValue({});
  void videoQueueItem.setValue([]);
  void musicListItem.setValue([]);
  void videoOnlyListItem.setValue([]);
  void videoDetailsItem.setValue({});

  void ensureProcessor();

  registerChunkHandlers();
  registerDownloadHandlers();
  registerPipelineHandlers();
  registerRecentDownloadsRetention();
  registerStorageHandlers();
  registerTabLifecycleHandlers();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === browser.runtime.OnInstalledReason.INSTALL) {
      void clearLocalStorage();
    }
  });
});
