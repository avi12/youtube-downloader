import { registerChunkHandlers } from "./chunk-handlers";
import { registerDownloadHandlers } from "./download-handlers";
import { registerPipelineHandlers } from "./pipeline-handlers";
import { ensureProcessor } from "./processor";
import { registerStorageHandlers } from "./storage-handlers";
import { registerTabLifecycleHandlers } from "./tab-lifecycle";
import { MessageType, sendMessage } from "@/lib/messaging";
import { onSabrBodyCaptured, startSabrRequestCapture } from "@/lib/sabr-request-capture";
import { clearLocalStorage } from "@/lib/storage";

const sabrOriginRuleId = 1;

// The background SW can't set the 'Origin' forbidden header via fetch() — the
// CDN requires Origin: https://www.youtube.com to authorize SABR requests.
// declarativeNetRequest injects it at the network layer, bypassing the restriction.
async function registerSabrOriginRule() {
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [sabrOriginRuleId],
    addRules: [{
      id: sabrOriginRuleId,
      priority: 1,
      action: {
        type: "modifyHeaders" as const,
        requestHeaders: [
          {
            header: "Origin",
            operation: "set" as const,
            value: "https://www.youtube.com"
          },
          {
            header: "Referer",
            operation: "set" as const,
            value: "https://www.youtube.com/"
          },
          {
            header: "Sec-Fetch-Site",
            operation: "set" as const,
            value: "cross-site"
          },
          {
            header: "Sec-Fetch-Storage-Access",
            operation: "set" as const,
            value: "active"
          }
        ]
      },
      condition: {
        urlFilter: "||googlevideo.com/videoplayback"
        // No resourceTypes filter — matches all types including SW fetch() requests
      }
    }]
  });
}

export default defineBackground(() => {
  void registerSabrOriginRule();
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
