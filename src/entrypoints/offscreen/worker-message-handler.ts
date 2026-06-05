import { removeWorkerIframe } from "./iframe-host";
import { handleProcessStreamChunk, handleProcessStreamChunkRaw } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { ProcessStreamEndData } from "@/lib/messaging/offscreen-messaging";
import { AUDIO_EXTRA_STREAM_PREFIX, StreamType } from "@/types";
import type { DownloadRequest, Prettify } from "@/types";

export const WORKER_MESSAGE_PREFIX = "worker-";
const WORKER_MESSAGE_CHUNK = "worker-chunk";
const WORKER_MESSAGE_STREAM_END = "worker-stream-end";
const WORKER_MESSAGE_COMPLETE = "worker-complete";
const WORKER_MESSAGE_NEEDS_DIRECT_URL = "worker-needs-direct-url";
const WORKER_MESSAGE_NEEDS_FALLBACK = "worker-needs-fallback";
const WORKER_MESSAGE_ERROR = "worker-error";

type WorkerChunkMessage = Prettify<{
  type: typeof WORKER_MESSAGE_CHUNK;
  videoId: string;
  streamType: string;
  iChunk: number;
  tabId: number;
  buffer: ArrayBuffer;
}>;
type WorkerStreamEndMessage = Prettify<{
  type: typeof WORKER_MESSAGE_STREAM_END;
  videoId: string;
  streamType: string;
  totalChunks: number;
}>;
type WorkerCompleteMessage = Prettify<{
  type: typeof WORKER_MESSAGE_COMPLETE;
  videoId: string;
  isStreamed: boolean;
  streamEnd: ProcessStreamEndData;
  videoBuffer?: ArrayBuffer;
  audioBuffer?: ArrayBuffer;
  extraAudioBuffers: ArrayBuffer[];
}>;
type WorkerNeedsDirectUrlMessage = Prettify<{
  type: typeof WORKER_MESSAGE_NEEDS_DIRECT_URL;
  videoId: string;
  tabId: number;
  request: DownloadRequest;
}>;
type WorkerNeedsFallbackMessage = Prettify<{
  type: typeof WORKER_MESSAGE_NEEDS_FALLBACK;
  videoId: string;
  tabId: number;
  request: DownloadRequest;
}>;
type WorkerErrorMessage = Prettify<{
  type: typeof WORKER_MESSAGE_ERROR;
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

function handleChunk(message: WorkerMessage) {
  if (message.type !== WORKER_MESSAGE_CHUNK) {
    return;
  }

  handleProcessStreamChunkRaw({
    videoId: message.videoId,
    streamType: message.streamType,
    iChunk: message.iChunk,
    totalChunks: 0,
    chunk: new Uint8Array(message.buffer)
  });
}

function handleStreamEnd(message: WorkerMessage) {
  if (message.type !== WORKER_MESSAGE_STREAM_END) {
    return;
  }

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

function handleComplete(message: WorkerMessage) {
  if (message.type !== WORKER_MESSAGE_COMPLETE) {
    return;
  }

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

function handleNeedsDirectUrl(message: WorkerMessage) {
  if (message.type !== WORKER_MESSAGE_NEEDS_DIRECT_URL) {
    return;
  }

  removeWorkerIframe(message.videoId);
  void sendMessage(MessageType.RequestDirectUrlDownload, {
    videoId: message.videoId,
    tabId: message.tabId,
    request: message.request
  });
}

function handleNeedsFallback(message: WorkerMessage) {
  if (message.type !== WORKER_MESSAGE_NEEDS_FALLBACK) {
    return;
  }

  removeWorkerIframe(message.videoId);
  void sendMessage(MessageType.RequestWatchPageFallback, {
    videoId: message.videoId,
    tabId: message.tabId,
    request: message.request
  });
}

function handleError(message: WorkerMessage) {
  if (message.type !== WORKER_MESSAGE_ERROR) {
    return;
  }

  removeWorkerIframe(message.videoId);
  void sendMessage(MessageType.ReportWorkerDownloadFailed, {
    videoId: message.videoId,
    tabId: message.tabId
  });
}

const WORKER_MESSAGE_HANDLERS: Record<WorkerMessage["type"], (message: WorkerMessage) => void> = {
  [WORKER_MESSAGE_CHUNK]: handleChunk,
  [WORKER_MESSAGE_STREAM_END]: handleStreamEnd,
  [WORKER_MESSAGE_COMPLETE]: handleComplete,
  [WORKER_MESSAGE_NEEDS_DIRECT_URL]: handleNeedsDirectUrl,
  [WORKER_MESSAGE_NEEDS_FALLBACK]: handleNeedsFallback,
  [WORKER_MESSAGE_ERROR]: handleError
};

export function handleWorkerMessage(message: WorkerMessage) {
  WORKER_MESSAGE_HANDLERS[message.type](message);
}
