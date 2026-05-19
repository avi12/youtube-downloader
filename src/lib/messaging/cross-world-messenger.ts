import type {
  ButtonViewModelData,
  DownloadRequest,
  DownloadType,
  ProgressUpdate,
  VideoData,
  VideoMetadata
} from "@/types";
import { ProgressType } from "@/types";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

export const CrossWorldMessage = {
  VideoData: "videoData",
  Navigation: "navigation",
  PanelContentReady: "panelContentReady",
  StreamError: "streamError",
  StreamData: "streamData",
  DownloadRequest: "downloadRequest",
  PanelClosed: "panelClosed",
  FilenameChanged: "filenameChanged",
  RequestVideoData: "requestVideoData",
  CancelDownload: "cancelDownload",
  ProxyFetch: "proxyFetch",
  IframePlayerReady: "iframePlayerReady",
  SetButtonData: "setButtonData",
  CreateDropdown: "createDropdown",
  DropdownReady: "dropdownReady",
  CloseDropdown: "closeDropdown",
  DownloadProgress: "downloadProgress",
  DownloadViaIframe: "downloadViaIframe",
  StartBackgroundDownload: "startBackgroundDownload",
  OptionsUpdate: "optionsUpdate",
  AudioTrackChanged: "audioTrackChanged",
  CaptionTrackChanged: "captionTrackChanged",
  OpenSnackbar: "openSnackbar",
  SetSettingsOptionsData: "setSettingsOptionsData",
  ButtonClick: "buttonClick",
  ProgressUpdate: "progressUpdate",
  DownloadBlobUrl: "downloadBlobUrl"
} as const;

export interface PageMessengerSchema {
  [CrossWorldMessage.VideoData](data: VideoData): void;
  [CrossWorldMessage.Navigation](data: { url: string }): void;
  [CrossWorldMessage.PanelContentReady](data: {
    contentId: string;
    videoDataJson: string;
  }): void;
  [CrossWorldMessage.StreamError](data: {
    videoId: string;
    error: string;
  }): void;
  [CrossWorldMessage.StreamData](data: {
    downloadType: DownloadType;
    videoId: string;
    filenameOutput: string;
    videoData: Uint8Array | null;
    audioData: Uint8Array | null;
    videoMimeType: string;
    audioMimeType: string;
    audioLabel: string;
    additionalAudioData: {
      data: Uint8Array | null;
      mimeType: string;
      label: string;
    }[];
    metadata?: VideoMetadata | null;
  }): void;
  [CrossWorldMessage.DownloadRequest](data: DownloadRequest): void;
  [CrossWorldMessage.PanelClosed](): void;
  [CrossWorldMessage.FilenameChanged](data: {
    filename: string;
    quality?: string;
    videoItag?: number;
    audioItag?: number;
    audioTrackId?: string;
  }): void;
  [CrossWorldMessage.RequestVideoData](data: { videoId: string }): void;
  [CrossWorldMessage.ProxyFetch](data: {
    url: string;
    method: string;
    bodyBase64: string;
    headers: Record<string, string>;
  }): {
    status: number;
    bodyBase64: string;
    responseHeaders: Record<string, string>;
  } | null;
  [CrossWorldMessage.IframePlayerReady](data: { videoId: string }): void;
  [CrossWorldMessage.CancelDownload](data: { videoIds: string[] }): void;
  [CrossWorldMessage.SetButtonData](data: {
    selector: string;
    data: ButtonViewModelData;
    a11y?: {
      tabIndex: number;
      role: string;
      ariaChecked: string;
    };
  }): void;
  [CrossWorldMessage.CreateDropdown](data: {
    contentId: string;
    positionTargetSelector: string;
  }): void;
  [CrossWorldMessage.DropdownReady](data: { contentId: string }): void;
  [CrossWorldMessage.CloseDropdown](data: { videoId: string }): void;
  [CrossWorldMessage.DownloadProgress](data: {
    videoId: string;
    progress: number;
    progressType: ProgressType;
  }): void;
  [CrossWorldMessage.DownloadViaIframe](data: DownloadRequest): void;
  [CrossWorldMessage.StartBackgroundDownload](data: { requestJson: string }): void;
  [CrossWorldMessage.OptionsUpdate](data: { isShowNativeDownload: boolean }): void;
  [CrossWorldMessage.AudioTrackChanged](data: { trackId: string }): void;
  [CrossWorldMessage.CaptionTrackChanged](data: {
    languageCode: string;
    vssId: string;
  }): void;
  [CrossWorldMessage.OpenSnackbar](): void;
  [CrossWorldMessage.SetSettingsOptionsData](data: {
    selector: string;
    title: string;
  }): void;
  [CrossWorldMessage.ButtonClick](data: { buttonId: string }): void;
  [CrossWorldMessage.ProgressUpdate](data: ProgressUpdate): void;
  [CrossWorldMessage.DownloadBlobUrl](data: {
    blobUrl: string;
    filename: string;
    videoId: string;
  }): void;
}

export type StreamDataPayload = Parameters<PageMessengerSchema[typeof CrossWorldMessage.StreamData]>[0];

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });

// Multi-subscriber fanout for button clicks. The messenger's per-type
// single-listener constraint is bypassed by maintaining one module-level
// listener that distributes to every subscribed handler. Same-context
// dispatches are also delivered locally because the messenger filters out
// its own instanceId, otherwise a MAIN-world emitter wouldn't reach a
// MAIN-world subscriber.

const buttonClickHandlers = new Set<(buttonId: string) => void>();

function fanoutButtonClick(buttonId: string) {
  for (const handler of buttonClickHandlers) {
    handler(buttonId);
  }
}

crossWorldMessenger.onMessage(CrossWorldMessage.ButtonClick, ({ data }) => {
  fanoutButtonClick(data.buttonId);
});

export function dispatchButtonClick(buttonId: string) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.ButtonClick, { buttonId });
  fanoutButtonClick(buttonId);
}

export function onButtonClick(handler: (buttonId: string) => void) {
  buttonClickHandlers.add(handler);
  return () => {
    buttonClickHandlers.delete(handler);
  };
}

/**
 * Multi-subscriber fanout for one-way cross-world events. Funnels through
 * `crossWorldMessenger` but distributes to every subscribed handler so the
 * messenger's per-type single-listener constraint doesn't apply. Same-context
 * emissions are dispatched locally too because the messenger filters out its
 * own instanceId.
 */

export const CrossWorldEvent = {
  ProgressUpdate: "progressUpdate"
} as const;

const progressHandlers = new Set<(data: ProgressUpdate) => void>();

function fanoutProgress(data: ProgressUpdate) {
  for (const handler of progressHandlers) {
    handler(data);
  }
}

crossWorldMessenger.onMessage(CrossWorldMessage.ProgressUpdate, ({ data }) => {
  fanoutProgress(data);
});

type EmitCrossWorldEventParams = {
  type: typeof CrossWorldEvent.ProgressUpdate;
  data: ProgressUpdate;
};
export function emitCrossWorldEvent({ type, data }: EmitCrossWorldEventParams) {
  void type;
  void crossWorldMessenger.sendMessage(CrossWorldMessage.ProgressUpdate, data);
  fanoutProgress(data);
}

type OnCrossWorldEventParams = {
  type: typeof CrossWorldEvent.ProgressUpdate;
  handler: (data: ProgressUpdate) => void;
};
export function onCrossWorldEvent({ type, handler }: OnCrossWorldEventParams) {
  void type;
  progressHandlers.add(handler);
  return () => {
    progressHandlers.delete(handler);
  };
}
