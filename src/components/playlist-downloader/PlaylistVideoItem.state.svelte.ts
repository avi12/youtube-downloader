import { resolveButtonLabel, resolveDownloadIconName } from "./PlaylistVideoItem.display";
import { cancelDownload, executeDownload } from "./PlaylistVideoItem.download";
import { createVideoItemEffects } from "./PlaylistVideoItem.effects.svelte";
import { buildButtonTooltip } from "./PlaylistVideoItem.helpers";
import { downloadProgressStore, type DownloadProgressState } from "@/lib/ui/synced-stores.svelte";
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

  createVideoItemEffects(
    videoId,
    value => {
      videoData = value;
    },
    value => {
      isLoadFailed = value;
    },
    value => {
      isLocallyDone = value;
    }
  );

  const buttonLabel = $derived(resolveButtonLabel(videoData, isLocallyDone, isDone, isDownloading, isDownloadFailed));
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
  const downloadIconName = $derived(resolveDownloadIconName(isLocallyDone, isDone, isDownloading, isDownloadFailed));

  async function handleDownloadClick() {
    if (!videoData?.isDownloadable || activeDownloadClicks.has(videoId)) {
      return;
    }

    if (isDownloading) {
      cancelDownload(videoId); return;
    }

    activeDownloadClicks.add(videoId);
    try {
      await executeDownload(videoData, videoId, gridTitle, value => {
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
    get isLocallyDone() {
      return isLocallyDone;
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
