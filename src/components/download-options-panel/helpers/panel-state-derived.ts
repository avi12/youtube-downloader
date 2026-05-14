import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { getOutputExtension } from "@/lib/utils/containers";
import { formatAudioCodecLabel, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type VideoData } from "@/types";

export function resolveActualExtension(
  downloadType: DownloadType,
  selectedVideoFormat: AdaptiveFormatItem | null,
  selectedAudioFormat: AdaptiveFormatItem | null,
  extension: string,
  getVideoData: () => VideoData
) {
  if (downloadType === DownloadType.Audio || !selectedVideoFormat || !selectedAudioFormat) {
    return extension;
  }

  const baseExtension = getOutputExtension({
    videoMimeType: selectedVideoFormat.mimeType,
    audioMimeType: selectedAudioFormat.mimeType,
    userExtension: extension
  });

  const selectedTrackId = selectedAudioFormat.audioTrack?.id;
  if (selectedTrackId && CONTENT_OPTIONS.value.downloadExtras) {
    const hasExtraAudioTracks = getVideoData().audioFormats.some(
      format => format.audioTrack?.id && format.audioTrack.id !== selectedTrackId
    );
    if (hasExtraAudioTracks) {
      return "mkv";
    }
  }

  return baseExtension;
}

export function resolvePrimaryState(
  isDownloading: boolean,
  isFailed: boolean,
  isInterrupted: boolean,
  isDone: boolean
): PrimaryButtonState {
  if (isDownloading) {
    return PrimaryButtonState.Downloading;
  }

  if (isFailed) {
    return PrimaryButtonState.Failed;
  }

  if (isInterrupted) {
    return PrimaryButtonState.Interrupted;
  }

  if (isDone) {
    return PrimaryButtonState.Done;
  }

  return PrimaryButtonState.Idle;
}

export function resolveQualityLabel(
  downloadType: DownloadType,
  selectedVideoFormat: AdaptiveFormatItem | null,
  selectedAudioFormat: AdaptiveFormatItem | null
) {
  if (downloadType === DownloadType.Audio) {
    return selectedAudioFormat
      ? `${Math.floor(selectedAudioFormat.bitrate / 1000)} kbps (${formatAudioCodecLabel(selectedAudioFormat.mimeType)})`
      : "";
  }

  return selectedVideoFormat ? formatVideoQualityLabel(selectedVideoFormat) : "";
}
