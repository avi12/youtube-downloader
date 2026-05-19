import {
  createDownloadIframe,
  createWorkerIframe,
  removeDownloadIframe,
  removeWorkerIframe,
  sendToWorkerIframe
} from "./iframe-host";
import { handleOffscreenAudioDownload } from "./sabr-audio-download";
import { handleProcessStreamChunk, handleProcessStreamChunkRaw } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { cancelDownloadsByIds } from "@/lib/download-pipeline";
import { revokePendingBlobUrl } from "@/lib/download-pipeline/blob-download";
import { initMuxWorker } from "@/lib/download-pipeline/ffmpeg-instance";
import { transcodeRecentDownload } from "@/lib/download-pipeline/transcode-recent";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, listenForOffscreenMessages } from "@/lib/messaging/offscreen-messaging";
import type { ProcessStreamEndData } from "@/lib/messaging/offscreen-messaging";
import { AUDIO_EXTRA_STREAM_PREFIX, StreamType } from "@/types";
import type { DownloadRequest } from "@/types";
import { browser } from "#imports";

type WorkerMessage =
  | {
    type: "worker-chunk";
    videoId: string;
    streamType: string;
    iChunk: number;
    tabId: number;
    buffer: ArrayBuffer;
  }
  | {
    type: "worker-stream-end";
    videoId: string;
    streamType: string;
    totalChunks: number;
  }
  | {
    type: "worker-complete";
    videoId: string;
    isStreamed: boolean;
    streamEnd: ProcessStreamEndData;
    videoBuffer?: ArrayBuffer;
    audioBuffer?: ArrayBuffer;
    extraAudioBuffers: ArrayBuffer[];
  }
  | {
    type: "worker-needs-direct-url";
    videoId: string;
    tabId: number;
    request: DownloadRequest;
  }
  | {
    type: "worker-needs-fallback";
    videoId: string;
    tabId: number;
    request: DownloadRequest;
  }
  | {
    type: "worker-error";
    videoId: string;
    tabId: number;
    error: string;
  };

function handleWorkerMessage(message: WorkerMessage) {
  switch (message.type) {
    case "worker-chunk": {
      handleProcessStreamChunkRaw({
        videoId: message.videoId,
        streamType: message.streamType,
        iChunk: message.iChunk,
        totalChunks: 0,
        chunk: new Uint8Array(message.buffer)
      });
      break;
    }

    case "worker-stream-end": {
      handleProcessStreamChunk({
        videoId: message.videoId,
        streamType: message.streamType,
        iChunk: -1,
        totalChunks: message.totalChunks,
        chunkBase64: "",
        tabId: 0
      });
      break;
    }

    case "worker-complete": {
      const { videoId, isStreamed, streamEnd, videoBuffer, audioBuffer, extraAudioBuffers } = message;
      if (!isStreamed) {
        if (videoBuffer) {
          handleProcessStreamChunkRaw({
            videoId,
            streamType: StreamType.Video,
            iChunk: 0,
            totalChunks: 1,
            chunk: new Uint8Array(videoBuffer)
          });
        }

        if (audioBuffer) {
          handleProcessStreamChunkRaw({
            videoId,
            streamType: StreamType.Audio,
            iChunk: 0,
            totalChunks: 1,
            chunk: new Uint8Array(audioBuffer)
          });
        }
      }

      for (const [i, buffer] of extraAudioBuffers.entries()) {
        handleProcessStreamChunkRaw({
          videoId,
          streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${i}`,
          iChunk: 0,
          totalChunks: 1,
          chunk: new Uint8Array(buffer)
        });
      }

      removeWorkerIframe(videoId);
      void handleProcessStreamEnd(streamEnd);
      void sendMessage(MessageType.WorkerDownloadComplete, { videoId });
      break;
    }

    case "worker-needs-direct-url": {
      removeWorkerIframe(message.videoId);
      void sendMessage(MessageType.RequestDirectUrlDownload, {
        videoId: message.videoId,
        tabId: message.tabId,
        request: message.request
      });
      break;
    }

    case "worker-needs-fallback": {
      removeWorkerIframe(message.videoId);
      void sendMessage(MessageType.RequestWatchPageFallback, {
        videoId: message.videoId,
        tabId: message.tabId,
        request: message.request
      });
      break;
    }

    case "worker-error": {
      removeWorkerIframe(message.videoId);
      void sendMessage(MessageType.ReportWorkerDownloadFailed, {
        videoId: message.videoId,
        tabId: message.tabId
      });
      break;
    }
  }
}

addEventListener("message", e => {
  if (e.origin !== location.origin) {
    return;
  }

  const message: WorkerMessage = e.data;
  if (!message?.type?.startsWith("worker-")) {
    return;
  }

  handleWorkerMessage(message);
});

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
      sendToWorkerIframe(videoId, { type: "cancel" });
      removeWorkerIframe(videoId);
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
  },
  [OffscreenMessageType.StartDownloadInIframe](data) {
    const { request, tabId, enrichedMetadata } = data;
    const elIframe = createWorkerIframe(request.videoId);
    elIframe.addEventListener("load", () => {
      elIframe.contentWindow?.postMessage(
        {
          type: "start",
          request,
          tabId,
          enrichedMetadata
        },
        location.origin
      );
    }, { once: true });
  }
});

const wasmBinary = await (await fetch(
  browser.runtime.getURL("/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm")
)).arrayBuffer();
await initMuxWorker(wasmBinary);
