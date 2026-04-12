import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging";
import {
  cancelRequestSignal,
  downloadProgressStore,
  type DownloadProgressState,
  videoDataStore
} from "@/lib/synced-stores.svelte";
import {
  calculateWeightedProgress,
  formatVideoQualityLabel,
  getOutputExtension,
  resolveAutoExtension,
  resolveVideoFilename
} from "@/lib/utils";
import {
  DownloadType,
  IconName,
  ProgressType,
  type Options,
  type VideoData
} from "@/types";

const videoDataLoadTimeoutMs = 15_000;

const defaultProgressState: DownloadProgressState = {
  isDownloading: false,
  isDone: false,
  progress: 0,
  progressType: ""
};

export function createPlaylistVideoItemState(
  videoId: string,
  gridTitle: string | undefined,
  getOptions: () => Options,
  activeDownloadClicks: Set<string>
) {
  let videoData = $state<VideoData | null>(null);
  let isLoadFailed = $state(false);

  const downloadState = $derived(downloadProgressStore.get(videoId) ?? defaultProgressState);
  const isDownloading = $derived(downloadState.isDownloading);
  const isDone = $derived(downloadState.isDone);

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

    if (isDone) {
      return "Downloaded";
    }

    if (isDownloading) {
      return "Cancel";
    }

    return "Download";
  });

  const displayProgress = $derived(
    calculateWeightedProgress(isDownloading, downloadState.progress, downloadState.progressType)
  );

  function buttonTooltip() {
    if (isDownloading) {
      if (downloadState.progress <= 0) {
        return buttonLabel;
      }

      const phase = downloadState.progressType === ProgressType.FFmpeg ? "Processing" : "Downloading";
      return `${Math.round(displayProgress)}% - ${phase}`;
    }

    if (!videoData?.isDownloadable) {
      return buttonLabel;
    }

    const options = getOptions();
    const videoFormat = videoData.videoFormats[0];
    const audioFormat = videoData.audioFormats[0];
    const resolvedExt = resolveAutoExtension(options.ext.video, videoFormat?.mimeType ?? "", DownloadType.Video);
    const extension = videoFormat && audioFormat
      ? getOutputExtension(videoFormat.mimeType, audioFormat.mimeType, resolvedExt)
      : resolvedExt;
    const quality = videoFormat ? formatVideoQualityLabel(videoFormat) : "";
    if (!quality) {
      return `${videoData.title}.${extension}`;
    }

    return `${videoData.title}.${extension} - ${quality}`;
  }

  function downloadIconName() {
    if (isDone) {
      return IconName.CheckCircleThick;
    }

    if (isDownloading) {
      return IconName.Close;
    }

    return IconName.Download;
  }

  async function startDownload() {
    if (!videoData?.isDownloadable) {
      return;
    }

    const options = getOptions();
    let downloadType: DownloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
    if (options.defaultDownloadType && options.defaultDownloadType !== "auto") {
      downloadType = options.defaultDownloadType;
    }

    const filenameOutput = resolveVideoFilename(videoData, options, gridTitle);

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
      cancelRequestSignal.value = { videoIds: [videoId] };
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
    get buttonLabel() {
      return buttonLabel;
    },
    get displayProgress() {
      return displayProgress;
    },
    buttonTooltip,
    downloadIconName,
    handleDownloadClick
  };
}
