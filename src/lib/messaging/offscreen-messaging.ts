import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import type { DownloadType, SubtitleStream, VideoMetadata } from "@/types";

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

const OffscreenMessageType = {
  ProcessStreamChunk: "processStreamChunk",
  ProcessStreamEnd: "processStreamEnd",
  CancelProcessing: "cancelProcessing",
  PipelineDownload: "pipelineDownload",
  TranscodeRecentDownload: "transcodeRecentDownload",
  SpawnIframe: "spawnIframe",
  RemoveIframe: "removeIframe"
} as const;

type OffscreenMessageType = (typeof OffscreenMessageType)[keyof typeof OffscreenMessageType];

interface OffscreenProtocolMap {
  [OffscreenMessageType.ProcessStreamChunk]: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
    tabId: number;
  };
  [OffscreenMessageType.ProcessStreamEnd]: {
    type: DownloadType;
    videoId: string;
    filenameOutput: string;
    videoMimeType: string;
    audioMimeType: string;
    audioTrackLabels: string[];
    subtitleStreams?: SubtitleStream[];
    tabId: number;
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    metadata?: VideoMetadata | null;
    // iframe-scrub multi-segment marker. When set, end-handler pulls from
    // accumulator.segments (keyed by 0..segmentCount-1) and assembles via
    // FFmpeg concat demuxer with MKV intermediate.
    segmentCount?: number;
    // Per-segment trim duration (seconds). Forwarded to the multipart pipeline
    // so it can `-t {N}` each pre-mux and strip the player's buffer-ahead
    // overshoot from the captured bytes.
    segmentDurationSec?: number;
    // Per-segment actual video buffer start (seconds in original timeline).
    // The VP9 player snaps to the nearest keyframe before the seek target,
    // so this is typically a few seconds earlier than `index * segmentDurationSec`.
    // The pipeline uses it for input-side -ss to align video and audio starts.
    segmentVideoBufferStartSecs?: (number | undefined)[];
  };
  [OffscreenMessageType.CancelProcessing]: {
    videoIds: string[];
  };
  [OffscreenMessageType.PipelineDownload]: {
    dataUrl: string;
    filename: string;
  };
  [OffscreenMessageType.TranscodeRecentDownload]: {
    entryId: string;
    targetContainer: string;
  };
  [OffscreenMessageType.SpawnIframe]: {
    id: string;
    url: string;
  };
  [OffscreenMessageType.RemoveIframe]: {
    id: string;
  };
}

type OffscreenMessage = {
  [T in OffscreenMessageType]: {
    type: T;
    data: OffscreenProtocolMap[T];
  };
}[OffscreenMessageType];

type OffscreenHandler<T extends OffscreenMessageType> = (data: OffscreenProtocolMap[T]) => void;
type HandlerMap = { [T in OffscreenMessageType]?: OffscreenHandler<T> };

function dispatchOffscreenMessage({ handlers, message }: {
  handlers: Partial<HandlerMap>;
  message: OffscreenMessage;
}) {
  switch (message.type) {
    case OffscreenMessageType.ProcessStreamChunk:
      handlers[OffscreenMessageType.ProcessStreamChunk]?.(message.data);
      break;
    case OffscreenMessageType.ProcessStreamEnd:
      handlers[OffscreenMessageType.ProcessStreamEnd]?.(message.data);
      break;
    case OffscreenMessageType.CancelProcessing:
      handlers[OffscreenMessageType.CancelProcessing]?.(message.data);
      break;
    case OffscreenMessageType.PipelineDownload:
      handlers[OffscreenMessageType.PipelineDownload]?.(message.data);
      break;
    case OffscreenMessageType.TranscodeRecentDownload:
      handlers[OffscreenMessageType.TranscodeRecentDownload]?.(message.data);
      break;
    case OffscreenMessageType.SpawnIframe:
      handlers[OffscreenMessageType.SpawnIframe]?.(message.data);
      break;
    case OffscreenMessageType.RemoveIframe:
      handlers[OffscreenMessageType.RemoveIframe]?.(message.data);
      break;
  }
}

let offscreenPort: Browser.runtime.Port | null = null;

function getOffscreenPort() {
  if (!offscreenPort) {
    offscreenPort = browser.runtime.connect({ name: OFFSCREEN_PORT_NAME });
    offscreenPort.onDisconnect.addListener(() => {
      offscreenPort = null;
    });
  }

  return offscreenPort;
}

function sendToOffscreen<T extends OffscreenMessageType>(
  type: T,
  data: OffscreenProtocolMap[T]
) {
  getOffscreenPort().postMessage({
    type,
    data
  });
}

const YIELD_EVERY_N_CHUNKS = 32;

// Shards a Uint8Array into TRANSFER_CHUNK_SIZE base64 chunks and pushes each
// one to the offscreen pipeline as a ProcessStreamChunk. Yields back to the
// event loop every 32 chunks so a multi-MB stream doesn't monopolize the BG
// main thread (relevant when the orchestrator is also driving keepalive).
async function sendBytesToOffscreen({ videoId, streamType, data, tabId }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
  tabId: number;
}) {
  const totalChunks = Math.max(1, Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE));
  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const slice = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(slice),
      tabId
    });

    if ((iChunk + 1) % YIELD_EVERY_N_CHUNKS === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

function listenForOffscreenMessages(handlers: HandlerMap) {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== OFFSCREEN_PORT_NAME) {
      return;
    }

    port.onMessage.addListener((message: OffscreenMessage) => {
      dispatchOffscreenMessage({
        handlers,
        message
      });
    });
  });
}

export { OffscreenMessageType, sendBytesToOffscreen, sendToOffscreen, listenForOffscreenMessages };
