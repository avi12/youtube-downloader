import { startTabDownload } from "../downloads/watch-download";
import type { PanelHost } from "@/lib/download-options/panel-host";
import { createLogger, LogScope } from "@/lib/utils/logger";
import type { Prettify } from "@/types";

const log = createLogger(LogScope.Popup);

type CreatePopupPanelHostParams = Prettify<{
  tabId: number;
  sourceUrl: string;
  onRequested: () => void;
}>;
export function createPopupPanelHost({ tabId, sourceUrl, onRequested }: CreatePopupPanelHostParams): PanelHost {
  return {
    requestDownload(request) {
      onRequested();
      startTabDownload({
        tabId,
        sourceUrl,
        videoId: request.videoId,
        request
      }).catch(error => log.warn("Starting the download failed:", error));
    }
  };
}
