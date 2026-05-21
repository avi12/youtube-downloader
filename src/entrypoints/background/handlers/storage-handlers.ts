import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { uint8ToBase64 } from "@/lib/utils/binary";
import {
  extractPoTokenFromBody,
  getCapturedSabrData,
  OFFSCREEN_PLAYER_TAB_ID
} from "@/lib/youtube/sabr/request-capture";

export function registerStorageHandlers() {
  onMessage(MessageType.GetCapturedSabrBody, ({ sender }) => {
    const tabId = sender.tab?.id ?? OFFSCREEN_PLAYER_TAB_ID;

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

  onMessage(MessageType.ClearInterruptedDownload, async ({ data }) => {
    await mutateStorageItem({
      item: interruptedDownloadsItem,
      mutator(current) {
        delete current[data.videoId];
      }
    });
  });

  onMessage(MessageType.GetInterruptedDownload, async ({ data }) => {
    const current = await interruptedDownloadsItem.getValue();
    return current[data.videoId] ?? null;
  });
}
