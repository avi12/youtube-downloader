import { clearInterruptedDownload, persistInterruptedDownload } from "../download/download-retry";
import { trackVideoForTab } from "../queue/tab-tracker";
import { ensureProcessor } from "./processor";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import type { OffscreenProtocolMap } from "@/lib/messaging/offscreen-protocol";
import { interruptedDownloadsItem } from "@/lib/storage/storage";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { extractPoTokenFromBody, getCapturedSabrData } from "@/lib/youtube/sabr/request-capture";

async function forwardChunk(
  tabId: number,
  data: Omit<OffscreenProtocolMap[typeof OffscreenMessageType.ProcessStreamChunk], "tabId">
) {
  await ensureProcessor();
  sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
    ...data,
    tabId
  });
}

async function forwardStreamEnd(
  tabId: number,
  data: Omit<OffscreenProtocolMap[typeof OffscreenMessageType.ProcessStreamEnd], "tabId">
) {
  await ensureProcessor();
  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    ...data,
    tabId
  });
}

function buildCapturedSabrBody(tabId: number) {
  const captured = getCapturedSabrData(tabId);
  if (!captured) {
    return null;
  }

  return {
    body: uint8ToBase64(new Uint8Array(captured.body)),
    url: captured.url,
    poToken: extractPoTokenFromBody(captured.body) ?? ""
  };
}

export function registerChunkHandlers() {
  onMessage(MessageType.StreamChunk, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return;
    }

    await forwardChunk(tabId, {
      videoId: data.videoId,
      streamType: data.streamType,
      iChunk: data.iChunk,
      totalChunks: data.totalChunks,
      chunkBytes: base64ToUint8Array(data.chunkBase64)
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
    await forwardStreamEnd(tabId, data);
  });
}

export function registerStorageHandlers() {
  onMessage(MessageType.GetCapturedSabrBody, ({ sender }) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return null;
    }

    return buildCapturedSabrBody(tabId);
  });

  onMessage(MessageType.PersistInterruptedDownload, ({ data }) => persistInterruptedDownload(data));
  onMessage(MessageType.ClearInterruptedDownload, ({ data }) => clearInterruptedDownload(data.videoId));
  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });
}
