import { PANEL_OPTIONS } from "../DownloadOptions.state.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { DownloadType, type AdaptiveFormatItem, type CaptionTrack, type VideoData } from "@/types";

export { applyDownloadTypeChange } from "./panel-type-change";

export function buildStartDownloadParams(params: {
  downloadType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  selectedCaptionTrack: CaptionTrack | null;
  isDownloading: boolean;
  isDownloadable: boolean;
  isFilenameValid: boolean;
  fullFilename: string;
  videoData: VideoData;
}) {
  const isStartBlocked =
    params.isDownloading || !params.isDownloadable || !params.isFilenameValid || !params.selectedAudioFormat;
  if (isStartBlocked) {
    return null;
  }

  const isVideoTypeWithoutFormat = params.downloadType !== DownloadType.Audio && !params.selectedVideoFormat;
  if (isVideoTypeWithoutFormat) {
    return null;
  }

  return {
    type: params.downloadType,
    videoId: params.videoData.videoId,
    videoItag: params.selectedVideoFormat?.itag ?? 0,
    audioItag: params.selectedAudioFormat!.itag,
    audioTrackId: params.selectedAudioFormat!.audioTrack?.id,
    selectedCaptionVssId: params.selectedCaptionTrack?.vssId,
    filenameOutput: params.fullFilename,
    sabrConfig: params.videoData.sabrConfig,
    downloadExtras: PANEL_OPTIONS.downloadExtras,
    downloadExtraCaptions: PANEL_OPTIONS.downloadExtraCaptions,
    includeAutoDubbing: PANEL_OPTIONS.includeAutoDubbing
  };
}

export function sendStartDownload(params: {
  downloadType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  selectedCaptionTrack: CaptionTrack | null;
  isDownloading: boolean;
  isDownloadable: boolean;
  isFilenameValid: boolean;
  fullFilename: string;
  videoData: VideoData;
}) {
  const payload = buildStartDownloadParams(params);
  if (!payload) {
    return;
  }

  void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, payload);
}

export function sendCancelDownload(videoId: string) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds: [videoId] });
}

export async function sendDiscardInterrupted(videoId: string) {
  interruptedDownloadStore.delete(videoId);
  await sendMessage(MessageType.ClearInterruptedDownload, { videoId });
}

export function sendRevealDownload(downloadId: number | null) {
  if (downloadId === null) {
    return;
  }

  void sendMessage(MessageType.RevealDownloadFile, { downloadId });
}
