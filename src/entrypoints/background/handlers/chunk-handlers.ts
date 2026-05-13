import { resolveTabId, trackVideoForTab } from "../queue/tab-tracker";
import { ensureProcessor } from "./processor";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

export function registerChunkHandlers() {
  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = resolveTabId(sender, data.videoId);
    if (!tabId) {
      return;
    }

    await ensureProcessor();
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      ...data,
      tabId
    });
  });

  onMessage(MessageType.StreamEnd, async ({ data, sender }) => {
    const tabId = resolveTabId(sender, data.videoId);
    if (!tabId) {
      return;
    }

    trackVideoForTab({
      videoId: data.videoId,
      tabId
    });
    await ensureProcessor();
    sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
      ...data,
      tabId
    });
  });
}
