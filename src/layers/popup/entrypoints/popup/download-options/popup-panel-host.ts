import type { PanelHost } from "@/lib/download-options/panel-host";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { createLogger, LogScope } from "@/lib/utils/logger";
import type { Prettify } from "@/types";

const log = createLogger(LogScope.Popup);

type CreatePopupPanelHostParams = Prettify<{
  sourceUrl: string;
  onRequested: () => void;
}>;
export function createPopupPanelHost({ sourceUrl, onRequested }: CreatePopupPanelHostParams): PanelHost {
  return {
    requestDownload(request) {
      onRequested();
      sendMessage(MessageType.StartPopupDownload, {
        videoId: request.videoId,
        sourceUrl,
        request
      }).catch(error => log.warn("Starting the mobile page download failed:", error));
    }
  };
}
