import { z } from "@/lib/zod";
import { tolerated, uncheckedArray } from "@/lib/zod-guard";
import type {
  AdaptiveFormatItem,
  DownloadRequest,
  Prettify,
  SabrConfig,
  VideoMetadata
} from "@/types";
import { DownloadType } from "@/types/download-enums";
import { videoMetadataSchema } from "@/types/settings-types";

export const processStreamEndSchema = z.looseObject({
  type: z.enum(DownloadType),
  videoId: z.string(),
  filenameOutput: z.string(),
  videoMimeType: z.string(),
  audioMimeType: z.string(),
  audioTrackLabels: uncheckedArray(z.string()),
  audioTrackLanguages: tolerated(z.array(z.string())),
  defaultAudioTrackIndex: tolerated(z.number()),
  subtitleTracks: tolerated(
    z.array(
      z.looseObject({
        dataBase64: z.string(),
        label: z.string(),
        languageCode: z.string()
      })
    )
  ),
  tabId: z.number(),
  playlistId: tolerated(z.string()),
  playlistTitle: tolerated(z.string()),
  playlistTotalCount: tolerated(z.number()),
  metadata: tolerated(videoMetadataSchema.nullable()),
  quality: tolerated(z.string()),
  sourceUrl: tolerated(z.string())
});

export const OffscreenMessageType = {
  ProcessStreamChunk: "processStreamChunk",
  ProcessStreamEnd: "processStreamEnd",
  CancelProcessing: "cancelProcessing",
  TranscodeRecentDownload: "transcodeRecentDownload",
  CreateDownloadIframe: "createDownloadIframe",
  RemoveDownloadIframe: "removeDownloadIframe",
  RevokeBlobUrl: "revokeBlobUrl",
  DownloadAudioViaSabr: "downloadAudioViaSabr",
  StartDownloadInIframe: "startDownloadInIframe"
} as const;

export type OffscreenMessageType = (typeof OffscreenMessageType)[keyof typeof OffscreenMessageType];

export interface OffscreenProtocolMap {
  [OffscreenMessageType.ProcessStreamChunk]: {
    videoId: string;
    streamType: string;
    iChunk: number;
    totalChunks: number;
    chunkBase64: string;
    tabId: number;
  };
  [OffscreenMessageType.ProcessStreamEnd]: ProcessStreamEndData;
  [OffscreenMessageType.CancelProcessing]: {
    videoIds: string[];
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
  [OffscreenMessageType.RevokeBlobUrl]: {
    blobUrl: string;
  };
  [OffscreenMessageType.DownloadAudioViaSabr]: {
    videoId: string;
    tabId: number;
    sabrConfig: SabrConfig;
    audioFormat: AdaptiveFormatItem;
    poToken: string;
    type: DownloadType;
    filenameOutput: string;
    audioMimeType: string;
    audioTrackLabels: string[];
    audioTrackLanguages: string[];
    subtitleTracks: {
      dataBase64: string;
      label: string;
      languageCode: string;
    }[];
    playlistId?: string;
    playlistTitle?: string;
    playlistTotalCount?: number;
    enrichedMetadata?: VideoMetadata | null;
  };
  [OffscreenMessageType.StartDownloadInIframe]: {
    request: DownloadRequest;
    tabId: number;
    enrichedMetadata: VideoMetadata | null;
  };
}

export type OffscreenMessage = {
  [T in OffscreenMessageType]: {
    type: T;
    data: OffscreenProtocolMap[T];
  };
}[OffscreenMessageType];

export type OffscreenHandler<T extends OffscreenMessageType> = (data: OffscreenProtocolMap[T]) => void;
export type HandlerMap = { [T in OffscreenMessageType]?: OffscreenHandler<T> };

export type ProcessStreamChunkData = Prettify<OffscreenProtocolMap[typeof OffscreenMessageType.ProcessStreamChunk]>;
export type ProcessStreamEndData = Prettify<z.infer<typeof processStreamEndSchema>>;

const OFFSCREEN_PORT_NAME = "ytdl-offscreen";

type DispatchOffscreenMessageParams = Prettify<{
  handlers: Partial<HandlerMap>;
  message: OffscreenMessage;
}>;
function dispatchOffscreenMessage({ handlers, message }: DispatchOffscreenMessageParams) {
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
    case OffscreenMessageType.TranscodeRecentDownload:
      handlers[OffscreenMessageType.TranscodeRecentDownload]?.(message.data);
      break;
    case OffscreenMessageType.CreateDownloadIframe:
      handlers[OffscreenMessageType.CreateDownloadIframe]?.(message.data);
      break;
    case OffscreenMessageType.RemoveDownloadIframe:
      handlers[OffscreenMessageType.RemoveDownloadIframe]?.(message.data);
      break;
    case OffscreenMessageType.RevokeBlobUrl:
      handlers[OffscreenMessageType.RevokeBlobUrl]?.(message.data);
      break;
    case OffscreenMessageType.DownloadAudioViaSabr:
      handlers[OffscreenMessageType.DownloadAudioViaSabr]?.(message.data);
      break;
    case OffscreenMessageType.StartDownloadInIframe:
      handlers[OffscreenMessageType.StartDownloadInIframe]?.(message.data);
      break;
  }
}

let swSidePort: Browser.runtime.Port | null = null;

export function isOffscreenConnected() {
  return swSidePort !== null;
}

export function initOffscreenPortListener() {
  browser.runtime.onConnect.addListener(port => {
    const isOffscreenPort = port.name === OFFSCREEN_PORT_NAME;
    if (!isOffscreenPort) {
      return;
    }

    swSidePort = port;
    port.onDisconnect.addListener(() => {
      swSidePort = null;
    });
  });
}

interface SendToOffscreenParams<T extends OffscreenMessageType> {
  type: T;
  data: OffscreenProtocolMap[T];
}
export function sendToOffscreen<T extends OffscreenMessageType>({ type, data }: SendToOffscreenParams<T>) {
  swSidePort?.postMessage({
    type,
    data
  });
}

export function listenForOffscreenMessages(handlers: HandlerMap) {
  function connect() {
    const port = browser.runtime.connect({ name: OFFSCREEN_PORT_NAME });
    port.onDisconnect.addListener(() => {
      connect();
    });
    port.onMessage.addListener(message => {
      dispatchOffscreenMessage({
        handlers,
        message
      });
    });
  }

  connect();
}
