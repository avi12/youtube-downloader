import type { ButtonViewModelData, DownloadRequest, StreamDataPayload, VideoData } from "@/types";
import { ProgressType } from "@/types";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

export enum CrossWorldMessage {
  VideoData = "videoData",
  Navigation = "navigation",
  PanelContentReady = "panelContentReady",
  StreamError = "streamError",
  StreamData = "streamData",

  DownloadRequest = "downloadRequest",
  PanelClosed = "panelClosed",
  FilenameChanged = "filenameChanged",
  RequestVideoData = "requestVideoData",
  CancelDownload = "cancelDownload",

  ProxyFetch = "proxyFetch",

  IframePlayerReady = "iframePlayerReady",

  CancelRequest = "cancelRequest",

  SetButtonData = "setButtonData",

  CreateDropdown = "createDropdown",

  DropdownReady = "dropdownReady",

  CloseDropdown = "closeDropdown",

  DownloadProgress = "downloadProgress",

  DownloadViaIframe = "downloadViaIframe",

  StartBackgroundDownload = "startBackgroundDownload"
}

interface PageMessengerSchema {
  [CrossWorldMessage.VideoData](data: VideoData): void;
  [CrossWorldMessage.Navigation](data: {
    url: string;
  }): void;
  [CrossWorldMessage.PanelContentReady](data: {
    contentId: string;
    videoData: VideoData;
  }): void;
  [CrossWorldMessage.StreamError](data: {
    videoId: string;
    error: string;
  }): void;
  [CrossWorldMessage.StreamData](data: StreamDataPayload): void;
  [CrossWorldMessage.DownloadRequest](data: DownloadRequest): void;
  [CrossWorldMessage.PanelClosed](data: Record<string, never>): void;
  [CrossWorldMessage.FilenameChanged](data: {
    filename: string;
    quality?: string;
    videoItag?: number;
    audioItag?: number;
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
  [CrossWorldMessage.StartBackgroundDownload](data: DownloadRequest): void;
}

export const crossWorldMessenger = defineCustomEventMessaging<PageMessengerSchema>({ namespace: "ytdl" });

const buttonClickEventName = "ytdl-btn-click";

type ButtonClickDetail = {
  buttonId: string;
};

function isButtonClickEvent(e: Event): e is CustomEvent<ButtonClickDetail> {
  return e instanceof CustomEvent && typeof e.detail?.buttonId === "string";
}

export function dispatchButtonClick(buttonId: string) {
  dispatchEvent(new CustomEvent<ButtonClickDetail>(buttonClickEventName, { detail: { buttonId } }));
}

export function onButtonClick(handler: (buttonId: string) => void) {
  function listener(e: Event) {
    if (isButtonClickEvent(e)) {
      handler(e.detail.buttonId);
    }
  }

  addEventListener(buttonClickEventName, listener);
  return () => removeEventListener(buttonClickEventName, listener);
}
