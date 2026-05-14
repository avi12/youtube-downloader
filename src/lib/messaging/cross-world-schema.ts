import { CrossWorldMessage } from "./cross-world-message-names";
import type {
  ButtonViewModelData,
  DownloadRequest,
  DownloadType,
  VideoData,
  VideoMetadata
} from "@/types";
import { ProgressType } from "@/types";

export { CrossWorldMessage } from "./cross-world-message-names";

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
}

export type StreamDataPayload = Parameters<PageMessengerSchema[typeof CrossWorldMessage.StreamData]>[0];
