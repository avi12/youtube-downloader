import type { PanelHost } from "@/lib/download-options/panel-host";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";

export const PAGE_PANEL_HOST: PanelHost = {
  measureSizeInputs: request => crossWorldMessenger.sendMessage(CrossWorldMessage.MeasureSizeInputs, request),
  announceSelection(selection) {
    crossWorldMessenger.sendMessage(CrossWorldMessage.FilenameChanged, selection).catch(() => {});
  },
  requestDownload(request) {
    crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, request).catch(() => {});
  }
};
