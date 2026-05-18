import { createDownloadIframe, removeDownloadIframe } from "./iframe-host";
import { handleOffscreenAudioDownload } from "./sabr-audio-download";
import { handleProcessStreamChunk } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds } from "@/lib/download-pipeline";
import { revokePendingBlobUrl } from "@/lib/download-pipeline/blob-download";
import { initMuxWorker } from "@/lib/download-pipeline/ffmpeg-instance";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
import { browser } from "#imports";

// Connect to the SW before FFmpeg init so the port is ready when
// PipelineFFmpegReady fires and the SW starts sending chunks.
listenForOffscreenMessages({
  [OffscreenMessageType.ProcessStreamChunk]: handleProcessStreamChunk,
  [OffscreenMessageType.ProcessStreamEnd](data) {
    void handleProcessStreamEnd(data);
  },
  [OffscreenMessageType.CancelProcessing](data) {
    void cancelDownloadsByIds(data.videoIds);
    for (const videoId of data.videoIds) {
      removeDownloadIframe(videoId);
    }
  },
  [OffscreenMessageType.TranscodeRecentDownload](data) {
    void transcodeRecentDownload(data);
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
    void handleOffscreenAudioDownload(data);
  }
});

const wasmBinary = await fetch(
  browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm")
).then(res => res.arrayBuffer());
await initMuxWorker(wasmBinary);
