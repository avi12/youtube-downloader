import type { PanelHost } from "@/lib/download-options/panel-host";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { isSizeInputs } from "#youtube/lib/messaging/payload-guards";

export const PAGE_PANEL_HOST: PanelHost = {
  async measureSizeInputs(request) {
    const response = await crossWorldMessenger.sendMessage(CrossWorldMessage.MeasureSizeInputs, request);
    return isSizeInputs(response) ? response : null;
  },
  announceSelection(selection) {
    crossWorldMessenger.sendMessage(CrossWorldMessage.FilenameChanged, selection).catch(() => {});
  },
  requestDownload(request) {
    crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, request).catch(() => {});
  }
};
