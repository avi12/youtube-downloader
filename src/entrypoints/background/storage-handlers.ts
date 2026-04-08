import { MessageType, onMessage } from "@/lib/messaging";
import { extractPoTokenFromBody, getCapturedSabrData } from "@/lib/sabr-request-capture";
import { interruptedDownloadsItem } from "@/lib/storage";
import { uint8ToBase64 } from "@/lib/utils";

export function registerStorageHandlers() {
  onMessage(MessageType.GetCapturedSabrBody, ({ sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      return null;
    }

    const captured = getCapturedSabrData(tabId);
    if (!captured) {
      return null;
    }

    const poToken = extractPoTokenFromBody(captured.body) ?? "";

    return {
      body: uint8ToBase64(new Uint8Array(captured.body)),
      url: captured.url,
      poToken
    };
  });

  onMessage(MessageType.PersistInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    current[data.videoId] = data;
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.ClearInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    delete current[data.videoId];
    await interruptedDownloadsItem.setValue(current);
  });

  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });
}
