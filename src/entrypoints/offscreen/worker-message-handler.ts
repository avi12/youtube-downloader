import { removeWorkerIframe } from "./iframe-host";
import { handleProcessStreamChunk, handleProcessStreamChunkRaw } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { ProcessStreamEndData } from "@/lib/messaging/offscreen-messaging";
import { AUDIO_EXTRA_STREAM_PREFIX, StreamType } from "@/types";
import type { DownloadRequest, Prettify } from "@/types";

export const WORKER_MSG_PREFIX = "worker-";
const WORKER_MSG_CHUNK = "worker-chunk";
const WORKER_MSG_STREAM_END = "worker-stream-end";
const WORKER_MSG_COMPLETE = "worker-complete";
const WORKER_MSG_NEEDS_DIRECT_URL = "worker-needs-direct-url";
const WORKER_MSG_NEEDS_FALLBACK = "worker-needs-fallback";
const WORKER_MSG_ERROR = "worker-error";

type WorkerChunkMessage = Prettify<{
  type: typeof WORKER_MSG_CHUNK;
  videoId: string;
  streamType: string;
  iChunk: number;
  tabId: number;
  buffer: ArrayBuffer;
}>;
type WorkerStreamEndMessage = Prettify<{
  type: typeof WORKER_MSG_STREAM_END;
  videoId: string;
  streamType: string;
  totalChunks: number;
}>;
type WorkerCompleteMessage = Prettify<{
  type: typeof WORKER_MSG_COMPLETE;
  videoId: string;
  isStreamed: boolean;
  streamEnd: ProcessStreamEndData;
  videoBuffer?: ArrayBuffer;
  audioBuffer?: ArrayBuffer;
  extraAudioBuffers: ArrayBuffer[];
}>;
type WorkerNeedsDirectUrlMessage = Prettify<{
  type: typeof WORKER_MSG_NEEDS_DIRECT_URL;
  videoId: string;
  tabId: number;
  request: DownloadRequest;
}>;
type WorkerNeedsFallbackMessage = Prettify<{
  type: typeof WORKER_MSG_NEEDS_FALLBACK;
  videoId: string;
  tabId: number;
  request: DownloadRequest;
}>;
type WorkerErrorMessage = Prettify<{
  type: typeof WORKER_MSG_ERROR;
  videoId: string;
  tabId: number;
  error: string;
}>;

export type WorkerMessage =
  | WorkerChunkMessage
  | WorkerStreamEndMessage
  | WorkerCompleteMessage
  | WorkerNeedsDirectUrlMessage
  | WorkerNeedsFallbackMessage
  | WorkerErrorMessage;

function handleChunk(message: WorkerChunkMessage) {
  handleProcessStreamChunkRaw({
    videoId: message.videoId,
    streamType: message.streamType,
    iChunk: message.iChunk,
    totalChunks: 0,
    chunk: new Uint8Array(message.buffer)
  });
}

function handleStreamEnd(message: WorkerStreamEndMessage) {
  handleProcessStreamChunk({
    videoId: message.videoId,
    streamType: message.streamType,
    iChunk: -1,
    totalChunks: message.totalChunks,
    chunkBase64: "",
    tabId: 0
  });
}

function feedSingleChunkBuffer({ videoId, streamType, buffer }: {
  videoId: string;
  streamType: string;
  buffer: ArrayBuffer;
}) {
  handleProcessStreamChunkRaw({
    videoId,
    streamType,
    iChunk: 0,
    totalChunks: 1,
    chunk: new Uint8Array(buffer)
  });
}

function handleComplete(message: WorkerCompleteMessage) {
  const { videoId, isStreamed, streamEnd, videoBuffer, audioBuffer, extraAudioBuffers } = message;
  if (!isStreamed) {
    if (videoBuffer) {
      feedSingleChunkBuffer({
        videoId,
        streamType: StreamType.Video,
        buffer: videoBuffer
      });
    }

    if (audioBuffer) {
      feedSingleChunkBuffer({
        videoId,
        streamType: StreamType.Audio,
        buffer: audioBuffer
      });
    }
  }

  for (const [i, buffer] of extraAudioBuffers.entries()) {
    feedSingleChunkBuffer({
      videoId,
      streamType: `${AUDIO_EXTRA_STREAM_PREFIX}-${i}`,
      buffer
    });
  }

  removeWorkerIframe(videoId);
  void handleProcessStreamEnd(streamEnd);
  void sendMessage(MessageType.WorkerDownloadComplete, { videoId });
}

function handleNeedsDirectUrl(message: WorkerNeedsDirectUrlMessage) {
  removeWorkerIframe(message.videoId);
  void sendMessage(MessageType.RequestDirectUrlDownload, {
    videoId: message.videoId,
    tabId: message.tabId,
    request: message.request
  });
}

function handleNeedsFallback(message: WorkerNeedsFallbackMessage) {
  removeWorkerIframe(message.videoId);
  void sendMessage(MessageType.RequestWatchPageFallback, {
    videoId: message.videoId,
    tabId: message.tabId,
    request: message.request
  });
}

function handleError(message: WorkerErrorMessage) {
  removeWorkerIframe(message.videoId);
  void sendMessage(MessageType.ReportWorkerDownloadFailed, {
    videoId: message.videoId,
    tabId: message.tabId
  });
}

export function handleWorkerMessage(message: WorkerMessage) {
  switch (message.type) {
    case WORKER_MSG_CHUNK: return handleChunk(message);
    case WORKER_MSG_STREAM_END: return handleStreamEnd(message);
    case WORKER_MSG_COMPLETE: return handleComplete(message);
    case WORKER_MSG_NEEDS_DIRECT_URL: return handleNeedsDirectUrl(message);
    case WORKER_MSG_NEEDS_FALLBACK: return handleNeedsFallback(message);
    case WORKER_MSG_ERROR: return handleError(message);
  }
}
