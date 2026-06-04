import { cancelDownloadsLocally } from "../download/cancel-actions";
import { uncancelStreamTransfer } from "../download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { downloadRequestSchema } from "@/lib/youtube/schemas";

export function registerDownloadProgressHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    void cancelDownloadsLocally(data.videoIds);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, ({ data }) => {
    const parsed = downloadRequestSchema.safeParse(JSON.parse(data.requestJson));
    if (!parsed.success) {
      return;
    }

    void sendMessage(MessageType.StartBackgroundDownload, parsed.data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, async ({ data }) => {
    const request = await sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
    if (request) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, request);
    }
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    uncancelStreamTransfer(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadBlobUrl, ({ data }) => {
    void sendMessage(MessageType.DownloadBlobUrl, data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.ReportPageProgress, ({ data }) => {
    void sendMessage(MessageType.ReportPageProgress, data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.ReportMainDownloadFailed, ({ data }) => {
    void sendMessage(MessageType.ReportWorkerDownloadFailed, {
      videoId: data.videoId,
      tabId: -1
    });
  });
}
