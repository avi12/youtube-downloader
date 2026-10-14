import { CONTENT_OPTIONS, type DownloadProgressState } from "@/lib/ui/synced-stores.svelte";
import { resolveOutputExtensionForFormats } from "@/lib/youtube/align-formats-to-container";
import { resolveAutoContainer } from "@/lib/youtube/auto-container";
import { formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import { ProgressType, type Prettify, type VideoData } from "@/types";

type ButtonTooltipParams = Prettify<{
  isLocallyDone: boolean;
  isDone: boolean;
  isDownloadFailed: boolean;
  isDownloading: boolean;
  isUnavailable?: boolean;
  isInBatch: boolean;
  downloadState: DownloadProgressState;
  displayProgress: number;
  buttonLabel: string;
  videoData: VideoData | null;
}>;

export function buildButtonTooltip({
  isLocallyDone,
  isDone,
  isDownloadFailed,
  isDownloading,
  isUnavailable = false,
  isInBatch,
  downloadState,
  displayProgress,
  buttonLabel,
  videoData
}: ButtonTooltipParams) {
  if (isUnavailable) {
    return "Video unavailable";
  }

  const isComplete = isLocallyDone || isDone;
  if (isComplete) {
    if (isInBatch) {
      return "Download completed";
    }

    return "Download again";
  }

  if (isDownloadFailed) {
    return "Download failed - click to retry";
  }

  if (isDownloading) {
    const isProgressUnknown = downloadState.progress <= 0 && downloadState.progressType !== ProgressType.FFmpeg;
    if (isProgressUnknown) {
      return buttonLabel;
    }

    const isFfmpegPhase = downloadState.progressType === ProgressType.FFmpeg;
    const activePhaseLabel = isFfmpegPhase ? "Processing" : "Downloading";
    return `${Math.round(displayProgress)}% - ${activePhaseLabel}`;
  }

  if (!videoData?.isDownloadable) {
    return buttonLabel;
  }

  const currentOptions = CONTENT_OPTIONS;
  const [primaryVideoFormat] = videoData.videoFormats;
  const [primaryAudioFormat] = videoData.audioFormats;
  const resolvedContainerExtension = resolveAutoContainer({
    extension: currentOptions.ext.video,
    videoData,
    sourceMimeType: primaryVideoFormat?.mimeType ?? "",
    codecPreferences: currentOptions
  });
  const isBothFormatsPresent = !!primaryVideoFormat && !!primaryAudioFormat;
  const containerExtension = isBothFormatsPresent
    ? resolveOutputExtensionForFormats({
      videoData,
      videoFormat: primaryVideoFormat,
      audioFormat: primaryAudioFormat,
      userExtension: resolvedContainerExtension,
      codecPreferences: currentOptions
    })
    : resolvedContainerExtension;
  const qualityLabel = primaryVideoFormat ? formatVideoQualityLabel(primaryVideoFormat) : "";
  if (!qualityLabel) {
    return `${videoData.title}.${containerExtension}`;
  }

  return `${videoData.title}.${containerExtension} - ${qualityLabel}`;
}
