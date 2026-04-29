import { trackVideoForTab } from "../queue/tab-tracker";
import { ensureProcessor } from "./processor";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { extractPoTokenFromBody, getCapturedSabrData } from "@/lib/youtube/sabr-request-capture";

export function registerChunkHandlers() {
  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
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
    const tabId = sender.tab?.id;
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

export function registerStorageHandlers() {
  onMessage(MessageType.GetCapturedSabrBody, ({ sender }) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return null;
    }

    const captured = getCapturedSabrData(tabId);
    if (!captured) {
      return null;
    }

    return {
      body: uint8ToBase64(new Uint8Array(captured.body)),
      url: captured.url,
      poToken: extractPoTokenFromBody(captured.body) ?? ""
    };
  });

  onMessage(MessageType.PersistInterruptedDownload, async ({ data }) => {
    await mutateStorageItem(interruptedDownloadsItem, current => {
      current[data.videoId] = data;
    });
  });

  onMessage(MessageType.ClearInterruptedDownload, async ({ data }) => {
    await mutateStorageItem(interruptedDownloadsItem, current => {
      delete current[data.videoId];
    });
  });

  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });
}
