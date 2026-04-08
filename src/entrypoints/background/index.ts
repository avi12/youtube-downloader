import { MessageType, sendMessage } from "../../lib/messaging";
import { onSabrBodyCaptured, startSabrRequestCapture } from "../../lib/sabr-request-capture";
import { clearLocalStorage } from "../../lib/storage";
import { registerChunkHandlers } from "./chunk-handlers";
import { registerDownloadHandlers } from "./download-handlers";
import { registerPipelineHandlers } from "./pipeline-handlers";
import { ensureProcessor } from "./processor";
import { registerStorageHandlers } from "./storage-handlers";
import { registerTabLifecycleHandlers } from "./tab-lifecycle";

export default defineBackground(() => {
  startSabrRequestCapture();
  onSabrBodyCaptured(tabId => {
    void sendMessage(MessageType.SabrBodyReady, {}, tabId);
  });

  void ensureProcessor();

  registerChunkHandlers();
  registerDownloadHandlers();
  registerPipelineHandlers();
  registerStorageHandlers();
  registerTabLifecycleHandlers();

  browser.runtime.onInstalled.addListener(({ reason }) => {
    // Only clear storage on fresh install, not on reload/update
    if (reason === browser.runtime.OnInstalledReason.INSTALL) {
      void clearLocalStorage();
    }
  });
});
