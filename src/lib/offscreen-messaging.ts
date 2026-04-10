import type { DownloadType, VideoMetadata } from "@/types";

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

enum OffscreenMessageType {
  ProcessStreamChunk = "processStreamChunk",
  ProcessStreamEnd = "processStreamEnd",
  CancelProcessing = "cancelProcessing",
  PipelineDownload = "pipelineDownload"
}

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
  [OffscreenMessageType.CancelProcessing]: { videoIds: string[] };
  [OffscreenMessageType.PipelineDownload]: {
    dataUrl: string;
    filename: string;
  };
}

interface OffscreenMessage<T extends OffscreenMessageType = OffscreenMessageType> {
  type: T;
  data: OffscreenProtocolMap[T];
}

// ─── Background (sender + receiver) ──────────────────────────────────────────

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
  getOffscreenPort().postMessage({ type, data } satisfies OffscreenMessage<T>);
}

type BackgroundHandler<T extends OffscreenMessageType> = (data: OffscreenProtocolMap[T]) => void;

function onOffscreenMessage<T extends OffscreenMessageType>(
  type: T,
  handler: BackgroundHandler<T>
) {
  const port = getOffscreenPort();
  port.onMessage.addListener((message: OffscreenMessage) => {
    if (message.type === type) {
      handler(message.data as OffscreenProtocolMap[T]);
    }
  });
}

// ─── Offscreen (receiver + sender) ───────────────────────────────────────────

type OffscreenHandler<T extends OffscreenMessageType> = (data: OffscreenProtocolMap[T]) => void;
type HandlerMap = { [T in OffscreenMessageType]?: OffscreenHandler<T> };

let connectedPort: Browser.runtime.Port | null = null;

function sendFromOffscreen<T extends OffscreenMessageType>(
  type: T,
  data: OffscreenProtocolMap[T]
) {
  connectedPort?.postMessage({ type, data } satisfies OffscreenMessage<T>);
}

function listenForOffscreenMessages(handlers: HandlerMap) {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== OFFSCREEN_PORT_NAME) {
      return;
    }

    connectedPort = port;
    port.onDisconnect.addListener(() => {
      connectedPort = null;
    });

    port.onMessage.addListener((message: OffscreenMessage) => {
      if (message.type in handlers) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- discriminated union dispatch
        (handlers[message.type] as ((data: OffscreenProtocolMap[OffscreenMessageType]) => void))?.(message.data);
      }
    });
  });
}

export {
  OffscreenMessageType,
  sendToOffscreen,
  onOffscreenMessage,
  sendFromOffscreen,
  listenForOffscreenMessages
};
