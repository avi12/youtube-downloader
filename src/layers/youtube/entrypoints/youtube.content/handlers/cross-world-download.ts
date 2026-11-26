import { cancelDownloadsLocally } from "@/layers/youtube/entrypoints/youtube.content/download/cancel-actions";
import { uncancelStreamTransfer } from "@/layers/youtube/entrypoints/youtube.content/download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { isDownloadRequest } from "@/lib/youtube/schemas";
import {
  isDownloadAnnouncement,
  isDownloadBlobUrlPayload,
  isDownloadFailedPayload,
  isPageProgressPayload,
  isRequestJsonPayload,
  isVideoIdPayload,
  isVideoIdsPayload
} from "#youtube/lib/messaging/payload-guards";

export function registerDownloadProgressHandlers() {
  crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
    if (!isVideoIdsPayload(data)) {
      return;
    }

    cancelDownloadsLocally(data.videoIds).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StartBackgroundDownload, ({ data }) => {
    if (!isRequestJsonPayload(data)) {
      return;
    }

    const request: unknown = JSON.parse(data.requestJson);
    if (!isDownloadRequest(request)) {
      return;
    }

    sendMessage(MessageType.StartBackgroundDownload, request).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.AnnounceDownload, ({ data }) => {
    if (!isDownloadAnnouncement(data)) {
      return;
    }

    sendMessage(MessageType.AnnounceDownload, data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.IframePlayerReady, async ({ data }) => {
    if (!isVideoIdPayload(data)) {
      return;
    }

    await sendMessage(MessageType.AwaitPlayerSession, { videoId: data.videoId }).catch(() => {});
    const request = await sendMessage(MessageType.DownloadIframeReady, { videoId: data.videoId });
    if (request) {
      await crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, request);
    }
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    if (!isDownloadRequest(data)) {
      return;
    }

    uncancelStreamTransfer(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadBlobUrl, ({ data }) => {
    if (!isDownloadBlobUrlPayload(data)) {
      return;
    }

    sendMessage(MessageType.DownloadBlobUrl, data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.ReportPageProgress, ({ data }) => {
    if (!isPageProgressPayload(data)) {
      return;
    }

    sendMessage(MessageType.ReportPageProgress, data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.ReportMainDownloadFailed, ({ data }) => {
    if (!isDownloadFailedPayload(data)) {
      return;
    }

    sendMessage(MessageType.ReportWorkerDownloadFailed, {
      videoId: data.videoId,
      tabId: -1,
      isUnavailable: data.isUnavailable
    }).catch(() => {});
  });
}
