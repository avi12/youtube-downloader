import { cancelDownloadsLocally } from "../download/cancel-actions";
import { uncancelStreamTransfer } from "../download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { downloadRequestSchema } from "@/lib/youtube/schemas";

export function registerDownloadProgressHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    cancelDownloadsLocally(data.videoIds).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, ({ data }) => {
    const parsed = downloadRequestSchema.safeParse(JSON.parse(data.requestJson));
    if (!parsed.success) {
      return;
    }

    sendMessage(MessageType.StartBackgroundDownload, parsed.data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, async ({ data }) => {
    const request = await sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
    if (request) {
      await crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, request);
    }
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    uncancelStreamTransfer(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadBlobUrl, ({ data }) => {
    sendMessage(MessageType.DownloadBlobUrl, data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.ReportPageProgress, ({ data }) => {
    sendMessage(MessageType.ReportPageProgress, data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.ReportMainDownloadFailed, ({ data }) => {
    sendMessage(MessageType.ReportWorkerDownloadFailed, {
      videoId: data.videoId,
      tabId: -1,
      isUnavailable: data.isUnavailable
    }).catch(() => {});
  });
}
