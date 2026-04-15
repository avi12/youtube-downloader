import type { DownloadType, VideoMetadata } from "@/types";

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

const OffscreenMessageType = {
  ProcessStreamChunk: "processStreamChunk",
  ProcessStreamEnd: "processStreamEnd",
  CancelProcessing: "cancelProcessing",
  PipelineDownload: "pipelineDownload",
  TranscodeRecentDownload: "transcodeRecentDownload"
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
    tabId: number;
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    metadata?: VideoMetadata | null;
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
}

type OffscreenMessage = {
  [T in OffscreenMessageType]: {
    type: T;
    data: OffscreenProtocolMap[T];
  };
}[OffscreenMessageType];

type OffscreenHandler<T extends OffscreenMessageType> = (data: OffscreenProtocolMap[T]) => void;
type HandlerMap = { [T in OffscreenMessageType]?: OffscreenHandler<T> };

function dispatchOffscreenMessage(handlers: Partial<HandlerMap>, message: OffscreenMessage) {
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
  getOffscreenPort().postMessage({ type, data });
}

function listenForOffscreenMessages(handlers: HandlerMap) {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== OFFSCREEN_PORT_NAME) {
      return;
    }

    port.onMessage.addListener((message: OffscreenMessage) => {
      dispatchOffscreenMessage(handlers, message);
    });
  });
}

export { OffscreenMessageType, sendToOffscreen, listenForOffscreenMessages };
