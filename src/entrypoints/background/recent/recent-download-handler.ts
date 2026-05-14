import { persistOnDownloadComplete } from "./recent-download-persist";
import { MessageType, onMessage } from "@/lib/messaging/messaging";

export function registerRecentDownloadHandlers() {
  onMessage(MessageType.PipelineDownload, async ({ data }) => {
    const downloadId = await browser.downloads.download({
      url: data.blobUrl,
      filename: data.filename
    });
    if (data.recentContext) {
      void persistOnDownloadComplete({
        downloadId,
        data
      });
    }
  });

  onMessage(MessageType.RevealDownloadFile, ({ data }) => {
    browser.downloads.show(data.downloadId);
  });
}
