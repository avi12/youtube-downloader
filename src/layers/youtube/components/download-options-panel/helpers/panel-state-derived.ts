import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { resolveMultiTrackExtension } from "@/lib/utils/containers";
import { resolveOutputExtensionForFormats } from "@/lib/youtube/align-formats-to-container";
import { AUTO_DUB_TRACK_SUFFIX } from "@/lib/youtube/download-plan";
import { formatAudioQualityLabel, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type VideoData } from "@/types";
import { PrimaryButtonState } from "#youtube/lib/ui/panel-button-attachments.svelte";

export function resolveActualExtension({
  downloadType,
  selectedVideoFormat,
  selectedAudioFormat,
  extension,
  getVideoData,
  downloadExtras
}: {
  downloadType: DownloadType;
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  extension: string;
  getVideoData: () => VideoData;
  downloadExtras: boolean;
}) {
  const isAudioOrMissingFormat = downloadType === DownloadType.Audio || !selectedVideoFormat || !selectedAudioFormat;
  if (isAudioOrMissingFormat) {
    return extension;
  }

  const baseExtension = resolveOutputExtensionForFormats({
    videoData: getVideoData(),
    videoFormat: selectedVideoFormat,
    audioFormat: selectedAudioFormat,
    userExtension: extension,
    codecPreferences: CONTENT_OPTIONS
  });

  const selectedTrackId = selectedAudioFormat.audioTrack?.id;
  const isTrackWithExtras = selectedTrackId && downloadExtras;
  if (isTrackWithExtras) {
    const isSelectedAutoDubbed = selectedTrackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
    const isAutoDubbingBlockedForSelected = !CONTENT_OPTIONS.includeAutoDubbing && isSelectedAutoDubbed;
    const isExtraAudioTracksPresent = !isAutoDubbingBlockedForSelected
      && getVideoData().audioFormats.some(format => {
        const trackId = format.audioTrack?.id;
        return trackId
          && trackId !== selectedTrackId
          && (CONTENT_OPTIONS.includeAutoDubbing || !trackId.endsWith(AUTO_DUB_TRACK_SUFFIX));
      });
    if (isExtraAudioTracksPresent) {
      return resolveMultiTrackExtension(baseExtension);
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
    return selectedAudioFormat ? formatAudioQualityLabel(selectedAudioFormat) : "";
  }

  return selectedVideoFormat ? formatVideoQualityLabel(selectedVideoFormat) : "";
}
