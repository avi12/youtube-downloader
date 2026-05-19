import { batchCanceledIds, batchDownloadStatus, batchVideoIds } from "../PlaylistDownloader.batch.svelte";
import type { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";

export function createBatchState(params: {
  readonly videoId: string;
  readonly isPlaylistItem: boolean;
  readonly itemState: ReturnType<typeof createPlaylistVideoItemState>;
}) {
  const isInBatch = $derived(batchVideoIds.has(params.videoId));
  const isIndividuallyCanceled = $derived(batchCanceledIds.has(params.videoId));

  const isCheckboxIndeterminate = $derived(
    batchDownloadStatus.isRunning && isInBatch && !isIndividuallyCanceled && params.itemState.isDownloading
  );
  const isCheckboxDisabled = $derived(
    batchDownloadStatus.isRunning || (params.itemState.isDownloading && !params.itemState.isLocallyDone)
  );
  const isZipBatchActive = $derived(
    batchDownloadStatus.isRunning && batchDownloadStatus.isZipBatch && isInBatch && !isIndividuallyCanceled
  );
  const isInProgressInZipBatch = $derived(isZipBatchActive && !params.itemState.isDownloading);
  const isProgressBarVisible = $derived(
    params.itemState.isDownloading
    || params.itemState.isDone
    || params.itemState.isLocallyDone
    || (params.isPlaylistItem && isInProgressInZipBatch)
  );
  const isProgressBarIndeterminate = $derived(
    !params.itemState.isDone
    && !params.itemState.isLocallyDone
    && !isInProgressInZipBatch
    && params.itemState.displayProgress === 0
  );
  const progressBarValue = $derived(
    params.itemState.isDone || params.itemState.isLocallyDone || isInProgressInZipBatch
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
