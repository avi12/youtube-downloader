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

const WORKER_MSG_PREFIX = "worker-";
const FFMPEG_WASM_PATH = "/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm";
const WORKER_MSG_CHUNK = "worker-chunk";
const WORKER_MSG_STREAM_END = "worker-stream-end";
const WORKER_MSG_COMPLETE = "worker-complete";
const WORKER_MSG_NEEDS_DIRECT_URL = "worker-needs-direct-url";
const WORKER_MSG_NEEDS_FALLBACK = "worker-needs-fallback";
const WORKER_MSG_ERROR = "worker-error";
const IFRAME_MSG_START = "start";
const IFRAME_MSG_CANCEL = "cancel";

type WorkerMessage =
  | {
    type: typeof WORKER_MSG_CHUNK;
    videoId: string;
    streamType: string;
    iChunk: number;
    tabId: number;
    buffer: ArrayBuffer;
  }
  | {
    type: typeof WORKER_MSG_STREAM_END;
    videoId: string;
    streamType: string;
    totalChunks: number;
  }
  | {
    type: typeof WORKER_MSG_COMPLETE;
    videoId: string;
    isStreamed: boolean;
    streamEnd: ProcessStreamEndData;
    videoBuffer?: ArrayBuffer;
    audioBuffer?: ArrayBuffer;
    extraAudioBuffers: ArrayBuffer[];
  }
  | {
    type: typeof WORKER_MSG_NEEDS_DIRECT_URL;
    videoId: string;
    tabId: number;
    request: DownloadRequest;
  }
  | {
    type: typeof WORKER_MSG_NEEDS_FALLBACK;
    videoId: string;
    tabId: number;
    request: DownloadRequest;
  }
  | {
    type: typeof WORKER_MSG_ERROR;
    videoId: string;
    tabId: number;
    error: string;
  };

function handleWorkerMessage(message: WorkerMessage) {
  switch (message.type) {
    case WORKER_MSG_CHUNK: {
      handleProcessStreamChunkRaw({
        videoId: message.videoId,
        streamType: message.streamType,
        iChunk: message.iChunk,
        totalChunks: 0,
        chunk: new Uint8Array(message.buffer)
      });
      break;
    }

    case WORKER_MSG_STREAM_END: {
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

    case WORKER_MSG_COMPLETE: {
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

    case WORKER_MSG_NEEDS_DIRECT_URL: {
      removeWorkerIframe(message.videoId);
      void sendMessage(MessageType.RequestDirectUrlDownload, {
        videoId: message.videoId,
        tabId: message.tabId,
        request: message.request
      });
      break;
    }

    case WORKER_MSG_NEEDS_FALLBACK: {
      removeWorkerIframe(message.videoId);
      void sendMessage(MessageType.RequestWatchPageFallback, {
        videoId: message.videoId,
        tabId: message.tabId,
        request: message.request
      });
      break;
    }

    case WORKER_MSG_ERROR: {
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
  const isExternalOrigin = e.origin !== location.origin;
  if (isExternalOrigin) {
    return;
  }

  const message: WorkerMessage = e.data;
  const isWorkerMessage = message?.type?.startsWith(WORKER_MSG_PREFIX);
  if (!isWorkerMessage) {
    return;
  }

  handleWorkerMessage(message);
});

listenForOffscreenMessages({
  [OffscreenMessageType.ProcessStreamChunk]: handleProcessStreamChunk,
  [OffscreenMessageType.ProcessStreamEnd](data) {
    void handleProcessStreamEnd(data);
  },
  [OffscreenMessageType.CancelProcessing](data) {
    void cancelDownloadsByIds(data.videoIds);
    for (const videoId of data.videoIds) {
      sendToWorkerIframe(videoId, { type: IFRAME_MSG_CANCEL });
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
          type: IFRAME_MSG_START,
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
  browser.runtime.getURL(FFMPEG_WASM_PATH)
)).arrayBuffer();
await initMuxWorker(wasmBinary);
