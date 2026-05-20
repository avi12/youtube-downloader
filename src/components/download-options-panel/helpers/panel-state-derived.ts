import { AUTO_DUB_TRACK_SUFFIX } from "./audio-language-helpers";
import { PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { CONTAINER_SPECS, MULTI_TRACK_UNSUPPORTED_EXTENSIONS, getOutputExtension } from "@/lib/utils/containers";
import { formatAudioCodecLabel, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import { DownloadType, type AdaptiveFormatItem, type VideoData } from "@/types";

const MKV_EXTENSION = "mkv";
const BITS_PER_KILOBIT = 1000;

function resolveMultiTrackExtension(baseExtension: string) {
  const isKnownContainer = baseExtension in CONTAINER_SPECS;
  return isKnownContainer && !MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(baseExtension) ? baseExtension : MKV_EXTENSION;
}

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

  const baseExtension = getOutputExtension({
    videoMimeType: selectedVideoFormat.mimeType,
    audioMimeType: selectedAudioFormat.mimeType,
    userExtension: extension
  });

  const selectedTrackId = selectedAudioFormat.audioTrack?.id;
  const isTrackWithExtras = selectedTrackId && downloadExtras;
  if (isTrackWithExtras) {
    const isSelectedAutoDubbed = selectedTrackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
    const isAutoDubbingBlockedForSelected = !CONTENT_OPTIONS.includeAutoDubbing && isSelectedAutoDubbed;
    const hasExtraAudioTracks = !isAutoDubbingBlockedForSelected
      && getVideoData().audioFormats.some(format => {
        const trackId = format.audioTrack?.id;
        return trackId
          && trackId !== selectedTrackId
          && (CONTENT_OPTIONS.includeAutoDubbing || !trackId.endsWith(AUTO_DUB_TRACK_SUFFIX));
      });
    if (hasExtraAudioTracks) {
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
    return selectedAudioFormat
      ? `${Math.floor(selectedAudioFormat.bitrate / BITS_PER_KILOBIT)} kbps (${formatAudioCodecLabel(selectedAudioFormat.mimeType)})`
      : "";
  }

  return selectedVideoFormat ? formatVideoQualityLabel(selectedVideoFormat) : "";
}
