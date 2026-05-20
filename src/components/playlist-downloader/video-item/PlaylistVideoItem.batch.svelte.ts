import { batchCanceledIds, batchDownloadStatus, batchVideoIds } from "../PlaylistDownloader.batch.svelte";
import type { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";

export function createBatchState(params: {
  readonly videoId: string;
  readonly isPlaylistItem: boolean;
  readonly itemState: ReturnType<typeof createPlaylistVideoItemState>;
}) {
  const isInBatch = $derived(batchVideoIds.has(params.videoId));
  const isIndividuallyCanceled = $derived(batchCanceledIds.has(params.videoId));

  const isActiveInBatch = $derived(batchDownloadStatus.isRunning && isInBatch && !isIndividuallyCanceled);
  const isCheckboxIndeterminate = $derived(isActiveInBatch && params.itemState.isDownloading);
  const isDownloadingAndNotDone = $derived(params.itemState.isDownloading && !params.itemState.isLocallyDone);
  const isCheckboxDisabled = $derived(batchDownloadStatus.isRunning || isDownloadingAndNotDone);
  const isZipBatchActive = $derived(isActiveInBatch && batchDownloadStatus.isZipBatch);
  const isInProgressInZipBatch = $derived(isZipBatchActive && !params.itemState.isDownloading);
  const isComplete = $derived(params.itemState.isDone || params.itemState.isLocallyDone);
  const isProgressBarVisible = $derived(
    params.itemState.isDownloading
    || isComplete
    || (params.isPlaylistItem && isInProgressInZipBatch)
  );
  const isProgressBarIndeterminate = $derived(
    !isComplete
    && !isInProgressInZipBatch
    && params.itemState.displayProgress === 0
  );
  const progressBarValue = $derived(
    isComplete || isInProgressInZipBatch
      ? 100
      : Math.round(params.itemState.displayProgress)
  );

  return {
    get isInBatch() {
      return isInBatch;
    },
    get isCheckboxIndeterminate() {
      return isCheckboxIndeterminate;
    },
    get isCheckboxDisabled() {
      return isCheckboxDisabled;
    },
    get isZipBatchActive() {
      return isZipBatchActive;
    },
    get isInProgressInZipBatch() {
      return isInProgressInZipBatch;
    },
    get isProgressBarVisible() {
      return isProgressBarVisible;
    },
    get isProgressBarIndeterminate() {
      return isProgressBarIndeterminate;
    },
    get progressBarValue() {
      return progressBarValue;
    }
  };
}
