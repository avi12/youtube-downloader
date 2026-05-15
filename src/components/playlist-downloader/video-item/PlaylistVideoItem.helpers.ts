import { CONTENT_OPTIONS, type DownloadProgressState } from "@/lib/ui/synced-stores.svelte";
import { getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import { formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import { ProgressType, type VideoData } from "@/types";

interface ButtonTooltipParams {
  isLocallyDone: boolean;
  isDone: boolean;
  isDownloadFailed: boolean;
  isDownloading: boolean;
  downloadState: DownloadProgressState;
  displayProgress: number;
  buttonLabel: string;
  videoData: VideoData | null;
}

export function buildButtonTooltip({
  isLocallyDone,
  isDone,
  isDownloadFailed,
  isDownloading,
  downloadState,
  displayProgress,
  buttonLabel,
  videoData
}: ButtonTooltipParams) {
  if (isLocallyDone || isDone) {
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

    const activePhaseLabel = downloadState.progressType === ProgressType.FFmpeg ? "Processing" : "Downloading";
    return `${Math.round(displayProgress)}% - ${activePhaseLabel}`;
  }

  if (!videoData?.isDownloadable) {
    return buttonLabel;
  }

  const currentOptions = CONTENT_OPTIONS;
  const [primaryVideoFormat] = videoData.videoFormats;
  const [primaryAudioFormat] = videoData.audioFormats;
  const resolvedContainerExtension = resolveAutoExtension({
    extension: currentOptions.ext.video,
    mimeType: primaryVideoFormat?.mimeType ?? ""
  });
  const containerExtension =
    primaryVideoFormat && primaryAudioFormat
      ? getOutputExtension({
        videoMimeType: primaryVideoFormat.mimeType,
        audioMimeType: primaryAudioFormat.mimeType,
        userExtension: resolvedContainerExtension
      })
      : resolvedContainerExtension;
  const qualityLabel = primaryVideoFormat ? formatVideoQualityLabel(primaryVideoFormat) : "";
  if (!qualityLabel) {
    return `${videoData.title}.${containerExtension}`;
  }

  return `${videoData.title}.${containerExtension} - ${qualityLabel}`;
}
