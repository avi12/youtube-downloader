import { removeWorkerIframe } from "./iframe-host";
import { discardStreamAccumulator, handleProcessStreamChunk, handleProcessStreamChunkRaw } from "./stream/accumulator";
import { handleProcessStreamEnd } from "./stream/end-handler";
import { type WorkerMessage, WorkerMessageKind } from "@/layers/processing/worker-frame-messages";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { AUDIO_EXTRA_STREAM_PREFIX, StreamType } from "@/types";

function handleChunk(message: WorkerMessage) {
  if (message.type !== WorkerMessageKind.Chunk) {
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
  if (message.type !== WorkerMessageKind.StreamEnd) {
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

function handleComplete(message: WorkerMessage) {
  if (message.type !== WorkerMessageKind.Complete) {
    return;
  }

  const { videoId, streamEnd, videoBuffer, audioBuffers } = message;
  const bufferedStreams = [
    {
      streamType: StreamType.Video,
      buffer: videoBuffer
    },
    ...audioBuffers.map((buffer, i) => ({
      streamType: i === 0 ? StreamType.Audio : `${AUDIO_EXTRA_STREAM_PREFIX}-${i - 1}`,
      buffer
    }))
  ];
  for (const { streamType, buffer } of bufferedStreams) {
    if (!buffer) {
      continue;
    }

    handleProcessStreamChunkRaw({
      videoId,
      streamType,
      iChunk: 0,
      totalChunks: 1,
      chunk: new Uint8Array(buffer)
    });
  }

  removeWorkerIframe(videoId);
  handleProcessStreamEnd(streamEnd).catch(() => {});
  sendMessage(MessageType.WorkerDownloadComplete, { videoId }).catch(() => {});
}

function handleNeedsDirectUrl(message: WorkerMessage) {
  if (message.type !== WorkerMessageKind.NeedsDirectUrl) {
    return;
  }

  removeWorkerIframe(message.videoId);
  sendMessage(MessageType.RequestDirectUrlDownload, {
    videoId: message.videoId,
    tabId: message.tabId,
    request: message.request
  }).catch(() => {});
}

function handleNeedsFallback(message: WorkerMessage) {
  if (message.type !== WorkerMessageKind.NeedsFallback) {
    return;
  }

  removeWorkerIframe(message.videoId);
  sendMessage(MessageType.RequestWatchPageFallback, {
    videoId: message.videoId,
    tabId: message.tabId,
    request: message.request
  }).catch(() => {});
}

function handleDiscardStreams(message: WorkerMessage) {
  if (message.type !== WorkerMessageKind.DiscardStreams) {
    return;
  }

  discardStreamAccumulator(message.videoId).catch(() => {});
}

function handleError(message: WorkerMessage) {
  if (message.type !== WorkerMessageKind.Error) {
    return;
  }

  removeWorkerIframe(message.videoId);
  sendMessage(MessageType.ReportWorkerDownloadFailed, {
    videoId: message.videoId,
    tabId: message.tabId
  }).catch(() => {});
}

const WORKER_MESSAGE_HANDLERS: Record<WorkerMessage["type"], (message: WorkerMessage) => void> = {
  [WorkerMessageKind.Chunk]: handleChunk,
  [WorkerMessageKind.StreamEnd]: handleStreamEnd,
  [WorkerMessageKind.Complete]: handleComplete,
  [WorkerMessageKind.NeedsDirectUrl]: handleNeedsDirectUrl,
  [WorkerMessageKind.NeedsFallback]: handleNeedsFallback,
  [WorkerMessageKind.DiscardStreams]: handleDiscardStreams,
  [WorkerMessageKind.Error]: handleError
};

export function handleWorkerMessage(message: WorkerMessage) {
  WORKER_MESSAGE_HANDLERS[message.type](message);
}
