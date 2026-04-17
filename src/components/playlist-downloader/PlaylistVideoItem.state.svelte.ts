import { batchCanceledIds, batchDownloadStatus, batchVideoIds } from "./PlaylistDownloader.state.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import {
  contentOptions,
  downloadProgressStore,
  type DownloadProgressState,
  videoDataStore
} from "@/lib/ui/synced-stores.svelte";
import { getOutputExtension, resolveAutoExtension, resolveVideoFilename } from "@/lib/utils/containers";
import { calculateWeightedProgress, formatVideoQualityLabel } from "@/lib/youtube/video-helpers";
import { DownloadType, IconName, ProgressType, type VideoData } from "@/types";

const videoDataLoadTimeoutMs = 15_000;

const defaultProgressState: DownloadProgressState = {
  isDownloading: false,
  isDone: false,
  progress: 0,
  progressType: ""
};

export function createPlaylistVideoItemState({ videoId, gridTitle, activeDownloadClicks }: {
  videoId: string;
  gridTitle: string | undefined;
  activeDownloadClicks: Set<string>;
}) {
  let videoData = $state<VideoData | null>(null);
  let isLoadFailed = $state(false);
  let isLocallyDone = $state(false);

  const downloadState = $derived(downloadProgressStore.get(videoId) ?? defaultProgressState);
  const isDownloading = $derived(downloadState.isDownloading);
  const isDone = $derived(downloadState.isDone);
  const isDownloadFailed = $derived(downloadState.isFailed === true);

  $effect(() => {
    const storeEntry = downloadProgressStore.get(videoId);
    if (storeEntry?.isDone) {
      isLocallyDone = true;
      return;
    }

    if (storeEntry === undefined || storeEntry.isFailed || storeEntry.isDownloading) {
      isLocallyDone = false;
    }
  });

  $effect(() => {
    const storeData = videoDataStore.get(videoId);
    if (storeData) {
      videoData = storeData;
      return;
    }

    void crossWorldMessenger.sendMessage(CrossWorldMessage.RequestVideoData, { videoId });

    const loadTimeout = setTimeout(() => {
      if (!videoData) {
        isLoadFailed = true;
      }
    }, videoDataLoadTimeoutMs);

    return () => clearTimeout(loadTimeout);
  });

  const buttonLabel = $derived.by(() => {
    if (!videoData?.isDownloadable) {
      return "N/A";
    }

    if (isLocallyDone || isDone) {
      return "Downloaded";
    }

    if (isDownloading) {
      return "Cancel";
    }

    if (isDownloadFailed) {
      return "Retry";
    }

    return "Download";
  });

  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading,
      progress: downloadState.progress,
      progressType: downloadState.progressType
    })
  );

  const buttonTooltip = $derived.by(() => {
    if (isLocallyDone || isDone) {
      return "Download again";
    }

    if (isDownloadFailed) {
      return "Download failed - click to retry";
    }

    if (isDownloading) {
      if (downloadState.progress <= 0) {
        return buttonLabel;
      }

      const activePhaseLabel = downloadState.progressType === ProgressType.FFmpeg ? "Processing" : "Downloading";
      return `${Math.round(displayProgress)}% - ${activePhaseLabel}`;
    }

    if (!videoData?.isDownloadable) {
      return buttonLabel;
    }

    const currentOptions = contentOptions.value;
    const primaryVideoFormat = videoData.videoFormats[0];
    const primaryAudioFormat = videoData.audioFormats[0];
    const resolvedContainerExtension = resolveAutoExtension({
      extension: currentOptions.ext.video,
      mimeType: primaryVideoFormat?.mimeType ?? "",
      type: DownloadType.Video
    });
    const containerExtension = primaryVideoFormat && primaryAudioFormat
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
  });

  const downloadIconName = $derived.by(() => {
    if (isLocallyDone || isDone) {
      return IconName.CheckCircleThick;
    }

    if (isDownloading) {
      return IconName.Close;
    }

    if (isDownloadFailed) {
      return IconName.Info;
    }

    return IconName.Download;
  });

  async function startDownload() {
    if (!videoData?.isDownloadable) {
      return;
    }

    const options = contentOptions.value;
    let downloadType: DownloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
    if (options.defaultDownloadType && options.defaultDownloadType !== "auto") {
      downloadType = options.defaultDownloadType;
    }

    const filenameOutput = resolveVideoFilename({
      videoData,
      options,
      titleOverride: gridTitle
    });

    isLocallyDone = false;
    downloadProgressStore.unsuppress(videoId);
    downloadProgressStore.set(videoId, {
      isDownloading: true,
      isDone: false,
      progress: 0,
      progressType: ""
    });

    // Chrome strips Origin from extension SW fetch, causing googlevideo 403.
    // Open a background watch tab where YouTube's SW handles CORS natively.
    await sendMessage(MessageType.DownloadViaWatchPage, {
      type: downloadType,
      videoId,
      videoItag: videoData.videoFormats[0]?.itag ?? 0,
      audioItag: videoData.audioFormats[0]?.itag ?? 0,
      filenameOutput
    });
  }

  async function handleDownloadClick() {
    if (!videoData?.isDownloadable || activeDownloadClicks.has(videoId)) {
      return;
    }

    if (isDownloading) {
      downloadProgressStore.delete(videoId);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoId] });

      if (batchDownloadStatus.isRunning && batchVideoIds.has(videoId)) {
        batchCanceledIds.add(videoId);
        checkedPlaylistVideos.delete(videoId);
      }

      return;
    }

    activeDownloadClicks.add(videoId);
    try {
      await startDownload();
    } finally {
      activeDownloadClicks.delete(videoId);
    }
  }

  return {
    get videoData() {
      return videoData;
    },
    get isLoadFailed() {
      return isLoadFailed;
    },
    get downloadState() {
      return downloadState;
    },
    get isDownloading() {
      return isDownloading;
    },
    get isDone() {
      return isDone;
    },
    get isDownloadFailed() {
      return isDownloadFailed;
    },
    get isLocallyDone() {
      return isLocallyDone;
    },
    get buttonLabel() {
      return buttonLabel;
    },
    get displayProgress() {
      return displayProgress;
    },
    get buttonTooltip() {
      return buttonTooltip;
    },
    get downloadIconName() {
      return downloadIconName;
    },
    handleDownloadClick
  };
}
