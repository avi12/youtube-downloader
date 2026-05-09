import type { DownloadType, VideoMetadata } from "@/types";

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

const OffscreenMessageType = {
  ProcessStreamChunk: "processStreamChunk",
  ProcessStreamEnd: "processStreamEnd",
  CancelProcessing: "cancelProcessing",
  PipelineDownload: "pipelineDownload",
  TranscodeRecentDownload: "transcodeRecentDownload",
  CreateDownloadIframe: "createDownloadIframe",
  RemoveDownloadIframe: "removeDownloadIframe"
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
    subtitleTracks?: {
      dataBase64: string;
      label: string;
      languageCode: string;
    }[];
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
  [OffscreenMessageType.CreateDownloadIframe]: {
    videoId: string;
    watchUrl: string;
  };
  [OffscreenMessageType.RemoveDownloadIframe]: {
    videoId: string;
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
    case OffscreenMessageType.CreateDownloadIframe:
      handlers[OffscreenMessageType.CreateDownloadIframe]?.(message.data);
      break;
    case OffscreenMessageType.RemoveDownloadIframe:
      handlers[OffscreenMessageType.RemoveDownloadIframe]?.(message.data);
      break;
  }
}

let swSidePort: Browser.runtime.Port | null = null;

function initOffscreenPortListener() {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== OFFSCREEN_PORT_NAME) {
      return;
    }

    swSidePort = port;
    port.onDisconnect.addListener(() => {
      swSidePort = null;
    });
  });
}

function sendToOffscreen<T extends OffscreenMessageType>(
  type: T,
  data: OffscreenProtocolMap[T]
) {
  swSidePort?.postMessage({
    type,
    data
  });
}

function listenForOffscreenMessages(handlers: HandlerMap) {
  function connect() {
    const port = browser.runtime.connect({ name: OFFSCREEN_PORT_NAME });
    port.onDisconnect.addListener(() => {
      connect();
    });
    port.onMessage.addListener((message: OffscreenMessage) => {
      dispatchOffscreenMessage({
        handlers,
        message
      });
    });
  }

  connect();
}

export { OffscreenMessageType, sendToOffscreen, listenForOffscreenMessages, initOffscreenPortListener };
