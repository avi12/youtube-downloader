import { MessageType, onMessage, sendMessage } from "../../lib/messaging";
import { ensureProcessor } from "./processor";
import { tabTracker, trackVideoForTab } from "./tab-tracker";

export function registerChunkHandlers() {
  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    await ensureProcessor();
    await sendMessage(MessageType.ProcessStreamChunk, { ...data, tabId });
  });

  onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    trackVideoForTab(data.videoId, tabId);
    tabTracker[tabId] ??= { videoIdsAvailable: [] };

    if (!tabTracker[tabId].videoIdsAvailable.includes(data.videoId)) {
      tabTracker[tabId].videoIdsAvailable.push(data.videoId);
    }

    await ensureProcessor();
    await sendMessage(MessageType.ProcessStreamEnd, { ...data, tabId });
  });
}
