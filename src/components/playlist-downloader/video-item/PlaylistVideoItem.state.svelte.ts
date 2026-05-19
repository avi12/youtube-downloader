import { resolveButtonLabel, resolveDownloadIconName } from "./PlaylistVideoItem.display";
import { cancelDownload, triggerDownload } from "./PlaylistVideoItem.download";
import { createVideoItemEffects } from "./PlaylistVideoItem.effects.svelte";
import { buildButtonTooltip } from "./PlaylistVideoItem.helpers";
import {
  downloadProgressStore,
  interruptedDownloadStore,
  type DownloadProgressState
} from "@/lib/ui/synced-stores.svelte";
import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
import { type VideoData } from "@/types";

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
  const isDownloadFailed = $derived(!!downloadState.isFailed);
  const isInterrupted = $derived(
    !!interruptedDownloadStore.get(videoId)
    && !isDownloading
    && !isDone
    && !isDownloadFailed
  );

  createVideoItemEffects({
    videoId,
    setVideoData(value) {
      videoData = value;
    },
    setIsLoadFailed(value) {
      isLoadFailed = value;
    },
    setIsLocallyDone(value) {
      isLocallyDone = value;
    }
  });

  const buttonLabel = $derived(
    resolveButtonLabel({
      videoData,
      isLocallyDone,
      isDone,
      isDownloading,
      isDownloadFailed
    })
  );
  const displayProgress = $derived(
    calculateWeightedProgress({
      isDownloading,
      progress: downloadState.progress,
      progressType: downloadState.progressType
    })
  );
  const buttonTooltip = $derived(
    buildButtonTooltip({
      isLocallyDone,
      isDone,
      isDownloadFailed,
      isDownloading,
      downloadState,
      displayProgress,
      buttonLabel,
      videoData
    })
  );
  const downloadIconName = $derived(
    resolveDownloadIconName({
      isLocallyDone,
      isDone,
      isDownloading,
      isDownloadFailed
    })
  );
  const downloadStateClass = $derived.by(() => {
    if (isDone || isLocallyDone) {
      return "done";
    }

    if (isDownloadFailed) {
      return "error";
    }

    if (isInterrupted) {
      return "interrupted";
    }

    if (isDownloading) {
      return "downloading";
    }

    return "";
  });
  const isIndeterminate = $derived(isDownloading && displayProgress === 0);
  const isProgressRingVisible = $derived(isDownloading);
  const effectiveProgress = $derived(isDownloading ? displayProgress / 100 : 0);

  async function handleDownloadClick() {
    const isReadyToDownload = !!videoData?.isDownloadable && !activeDownloadClicks.has(videoId);
    if (!isReadyToDownload) {
      return;
    }

    if (isDownloading) {
      cancelDownload(videoId); return;
    }

    activeDownloadClicks.add(videoId);
    try {
      await triggerDownload(videoData!, videoId, gridTitle, value => {
        isLocallyDone = value;
      });
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
    get isInterrupted() {
      return isInterrupted;
    },
    get isLocallyDone() {
      return isLocallyDone;
    },
    get displayProgress() {
      return displayProgress;
    },
    get effectiveProgress() {
      return effectiveProgress;
    },
    get isIndeterminate() {
      return isIndeterminate;
    },
    get isProgressRingVisible() {
      return isProgressRingVisible;
    },
    get downloadStateClass() {
      return downloadStateClass;
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
