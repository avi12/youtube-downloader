import { ensureProcessor } from "./processor";
import { trackVideoForTab } from "./tab-tracker";
import { MessageType, onMessage } from "@/lib/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/offscreen-messaging";

export function registerChunkHandlers() {
  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    await ensureProcessor();
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, { ...data, tabId });
  });

  onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    trackVideoForTab(data.videoId, tabId);
    await ensureProcessor();
    sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, { ...data, tabId });
  });
}
