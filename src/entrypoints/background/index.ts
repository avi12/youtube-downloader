import { registerChunkHandlers } from "./handlers/chunk-handlers";
import { registerDownloadHandlers } from "./handlers/download-handlers";
import { registerPipelineHandlers } from "./handlers/pipeline-handlers";
import { ensureProcessor } from "./handlers/processor";
import { registerStorageHandlers } from "./handlers/storage-handlers";
import { registerTabLifecycleHandlers } from "./handlers/tab-lifecycle";
import { registerSabrOriginRule } from "./network-rules";
import { registerRecentDownloadsRetention } from "./recent/recent-downloads-retention";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { initOffscreenPortListener } from "@/lib/messaging/offscreen-messaging";
import {
  clearLocalStorage,
  musicListItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { onSabrBodyCaptured, startSabrRequestCapture } from "@/lib/youtube/sabr/request-capture";

export default defineBackground(async () => {
  initOffscreenPortListener();
  void registerSabrOriginRule();
  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    void sendMessage(MessageType.SabrBodyReady, undefined, tabId);
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
