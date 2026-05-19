import { AUTO_DUB_TRACK_SUFFIX } from "./audio-language-helpers";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { getOutputExtension } from "@/lib/utils/containers";
import { formatAudioCodecLabel, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type VideoData } from "@/types";

const MKV_EXTENSION = "mkv";

export function resolveActualExtension({
  downloadType,
  selectedVideoFormat,
  selectedAudioFormat,
  extension,
  getVideoData
}: {
  downloadType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  extension: string;
  getVideoData: () => VideoData;
}) {
  const isAudioOrMissingFormat = downloadType === DownloadType.Audio || !selectedVideoFormat || !selectedAudioFormat;
  if (isAudioOrMissingFormat) {
    return extension;
  }

  const baseExtension = getOutputExtension({
    videoMimeType: selectedVideoFormat.mimeType,
    audioMimeType: selectedAudioFormat.mimeType,
    userExtension: extension
  });

  const selectedTrackId = selectedAudioFormat.audioTrack?.id;
  const isTrackWithExtras = selectedTrackId && CONTENT_OPTIONS.downloadExtras;
  if (isTrackWithExtras) {
    const isSelectedAutoDubbed = selectedTrackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
    const hasExtraAudioTracks = !(!CONTENT_OPTIONS.includeAutoDubbing && isSelectedAutoDubbed)
      && getVideoData().audioFormats.some(format => {
        const trackId = format.audioTrack?.id;
        return trackId
          && trackId !== selectedTrackId
          && (CONTENT_OPTIONS.includeAutoDubbing || !trackId.endsWith(AUTO_DUB_TRACK_SUFFIX));
      });
    if (hasExtraAudioTracks) {
      return MKV_EXTENSION;
    }
  }

  return baseExtension;
}

export function resolvePrimaryState({
  isDownloading,
  isFailed,
  isInterrupted,
  isDone
}: {
  isDownloading: boolean;
  isFailed: boolean;
  isInterrupted: boolean;
  isDone: boolean;
}) {
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

export function resolveQualityLabel({
  downloadType,
  selectedVideoFormat,
  selectedAudioFormat
}: {
  downloadType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
}) {
  const isAudioType = downloadType === DownloadType.Audio;
  if (isAudioType) {
    return selectedAudioFormat
      ? `${Math.floor(selectedAudioFormat.bitrate / 1000)} kbps (${formatAudioCodecLabel(selectedAudioFormat.mimeType)})`
      : "";
  }

  return selectedVideoFormat ? formatVideoQualityLabel(selectedVideoFormat) : "";
}
