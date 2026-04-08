import { ensureProcessor } from "./processor";
import { trackVideoForTab } from "./tab-tracker";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging";

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
    await ensureProcessor();
    await sendMessage(MessageType.ProcessStreamEnd, { ...data, tabId });
  });
}
