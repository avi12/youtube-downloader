import { PANEL_OPTIONS } from "../DownloadOptions.state.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { performCancelDownload } from "@/lib/ui/cancel-download";
import { interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import {
  DownloadType,
  type AdaptiveFormatItem,
  type CaptionTrack,
  type CodecPreferences,
  type VideoData
} from "@/types";

export { applyDownloadTypeChange } from "./panel-type-change";

type BuildDownloadPlanParamsParams = {
  downloadType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  selectedCaptionTrack: CaptionTrack | null;
  codecPreferences: CodecPreferences;
};
export function buildDownloadPlanParams(params: BuildDownloadPlanParamsParams) {
  return {
    type: params.downloadType,
    videoItag: params.selectedVideoFormat?.itag ?? 0,
    audioItag: params.selectedAudioFormat?.itag ?? 0,
    audioTrackId: params.selectedAudioFormat?.audioTrack?.id,
    codecPreferences: params.codecPreferences,
    selectedCaptionVssId: params.selectedCaptionTrack?.vssId,
    downloadExtras: PANEL_OPTIONS.downloadExtras,
    downloadExtraCaptions: PANEL_OPTIONS.downloadExtraCaptions,
    includeAutoDubbing: PANEL_OPTIONS.includeAutoDubbing
  };
}

function buildStartDownloadParams(params: BuildDownloadPlanParamsParams & {
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
    ...buildDownloadPlanParams(params),
    videoId: params.videoData.videoId,
    filenameOutput: params.fullFilename
  };
}

export function sendStartDownload(params: Parameters<typeof buildStartDownloadParams>[0]) {
  const payload = buildStartDownloadParams(params);
  if (!payload) {
    return;
  }

  crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, payload).catch(() => {});
}

export function sendCancelDownload(videoId: string) {
  performCancelDownload([videoId]).catch(() => {});
}

export async function sendDiscardInterrupted(videoId: string) {
  interruptedDownloadStore.delete(videoId);
  await sendMessage(MessageType.ClearInterruptedDownload, { videoId });
}

export function sendRevealDownload(downloadId: number | null) {
  if (downloadId === null) {
    return;
  }

  sendMessage(MessageType.RevealDownloadFile, { downloadId }).catch(() => {});
}
