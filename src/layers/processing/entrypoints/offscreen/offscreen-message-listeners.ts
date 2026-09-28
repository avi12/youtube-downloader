import {
  createDownloadIframe,
  createWorkerIframe,
  removeDownloadIframe,
  removeWorkerIframe,
  sendToWorkerIframe
} from "./iframe-host";
import { handleOffscreenAudioDownload } from "./sabr-audio-download";
import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds } from "@/lib/download-pipeline";
import { revokePendingBlobUrl } from "@/lib/download-pipeline/blob-download";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";

const IFRAME_MESSAGE_START = "start";
const IFRAME_MESSAGE_CANCEL = "cancel";

export function registerOffscreenMessageListeners() {
  listenForOffscreenMessages({
    [OffscreenMessageType.ProcessStreamChunk]: handleProcessStreamChunk,
    [OffscreenMessageType.ProcessStreamEnd](data) {
      handleProcessStreamEnd(data).catch(() => {});
    },
    [OffscreenMessageType.CancelProcessing](data) {
      cancelDownloadsByIds(data.videoIds).catch(() => {});
      for (const videoId of data.videoIds) {
        sendToWorkerIframe(videoId, { type: IFRAME_MESSAGE_CANCEL });
        removeWorkerIframe(videoId);
        removeDownloadIframe(videoId);
      }
    },
    [OffscreenMessageType.TranscodeRecentDownload](data) {
      transcodeRecentDownload(data).catch(() => {});
    },
    [OffscreenMessageType.CreateDownloadIframe](data) {
      createDownloadIframe(data);
    },
    [OffscreenMessageType.RemoveDownloadIframe](data) {
      removeDownloadIframe(data.videoId);
    },
    [OffscreenMessageType.RevokeBlobUrl](data) {
      revokePendingBlobUrl(data.blobUrl);
    },
    [OffscreenMessageType.DownloadAudioViaSabr](data) {
      handleOffscreenAudioDownload(data).catch(() => {});
    },
    [OffscreenMessageType.StartDownloadInIframe](data) {
      const { request, tabId, enrichedMetadata } = data;
      const elIframe = createWorkerIframe(request.videoId);
      elIframe.addEventListener("load", () => {
        elIframe.contentWindow?.postMessage(
          {
            type: IFRAME_MESSAGE_START,
            request,
            tabId,
            enrichedMetadata
          },
          location.origin
        );
      }, { once: true });
    }
  });
}
