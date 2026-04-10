import type { DownloadType, ProgressUpdate, VideoMetadata } from "@/types";

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

enum OffscreenMessageType {
  ProcessStreamChunk = "processStreamChunk",
  ProcessStreamEnd = "processStreamEnd",
  CancelProcessing = "cancelProcessing"
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
  [OffscreenMessageType.CancelProcessing]: {
    videoIds: string[];
  };
}

interface OffscreenMessage<T extends OffscreenMessageType = OffscreenMessageType> {
  type: T;
  data: OffscreenProtocolMap[T];
}

// ─── Background (sender) ─────────────────────────────────────────────────────

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

// ─── Offscreen (receiver) ─────────────────────────────────────────────────────

type OffscreenHandler<T extends OffscreenMessageType> = (data: OffscreenProtocolMap[T]) => void;
type HandlerMap = { [T in OffscreenMessageType]?: OffscreenHandler<T> };

function listenForOffscreenMessages(handlers: HandlerMap) {
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== OFFSCREEN_PORT_NAME) {
      return;
    }

    port.onMessage.addListener((message: OffscreenMessage) => {
      const handler = handlers[message.type] as OffscreenHandler<typeof message.type> | undefined;
      handler?.(message.data);
    });
  });
}

export { OffscreenMessageType, sendToOffscreen, listenForOffscreenMessages };
export type { OffscreenProtocolMap };
