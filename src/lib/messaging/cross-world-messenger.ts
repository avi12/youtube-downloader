import type {
  ButtonViewModelData,
  DownloadRequest,
  DownloadType,
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
  CancelRequest: "cancelRequest",
  SetButtonData: "setButtonData",
  CreateDropdown: "createDropdown",
  DropdownReady: "dropdownReady",
  CloseDropdown: "closeDropdown",
  DownloadProgress: "downloadProgress",
  DownloadViaIframe: "downloadViaIframe",
  StartBackgroundDownload: "startBackgroundDownload",
  OptionsUpdate: "optionsUpdate"
} as const;

interface PageMessengerSchema {
  [CrossWorldMessage.VideoData](data: VideoData): void;
  [CrossWorldMessage.Navigation](data: {
    url: string;
  }): void;
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
  [CrossWorldMessage.PanelClosed](data: Record<string, never>): void;
  [CrossWorldMessage.FilenameChanged](data: {
    filename: string;
    quality?: string;
    videoItag?: number;
    audioItag?: number;
    audioTrackId?: string;
  }): void;
  [CrossWorldMessage.RequestVideoData](data: {
    videoId: string;
  }): void;
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

  [CrossWorldMessage.IframePlayerReady](data: {
    videoId: string;
  }): void;
  [CrossWorldMessage.CancelDownload](data: {
    videoIds: string[];
  }): void;
  [CrossWorldMessage.CancelRequest](data: {
    videoIds: string[];
  }): void;
  [CrossWorldMessage.SetButtonData](data: {
    selector: string;
    data: ButtonViewModelData;
  }): void;
  [CrossWorldMessage.CreateDropdown](data: {
    contentId: string;
    positionTargetSelector: string;
  }): void;
  [CrossWorldMessage.DropdownReady](data: {
    contentId: string;
  }): void;
  [CrossWorldMessage.CloseDropdown](data: {
    videoId: string;
  }): void;
  [CrossWorldMessage.DownloadProgress](data: {
    videoId: string;
    progress: number;
    progressType: ProgressType;
  }): void;
  [CrossWorldMessage.DownloadViaIframe](data: DownloadRequest): void;
  [CrossWorldMessage.StartBackgroundDownload](data: { requestJson: string }): void;
  [CrossWorldMessage.OptionsUpdate](data: {
    isShowNativeDownload: boolean;
  }): void;
}

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });

export type StreamDataPayload = Parameters<PageMessengerSchema[typeof CrossWorldMessage.StreamData]>[0];

const BUTTON_CLICK_EVENT_NAME = "ytdl-btn-click";

function isButtonClickEvent(e: Event): e is CustomEvent<{ buttonId: string }> {
  return e instanceof CustomEvent && typeof e.detail?.buttonId === "string";
}

export function dispatchButtonClick(buttonId: string) {
  dispatchEvent(
    new CustomEvent<{ buttonId: string }>(BUTTON_CLICK_EVENT_NAME, {
      detail: {
        buttonId
      }
    })
  );
}

export function onButtonClick(handler: (buttonId: string) => void) {
  function listener(e: Event) {
    if (isButtonClickEvent(e)) {
      handler(e.detail.buttonId);
    }
  }

  addEventListener(BUTTON_CLICK_EVENT_NAME, listener);
  return () => removeEventListener(BUTTON_CLICK_EVENT_NAME, listener);
}
