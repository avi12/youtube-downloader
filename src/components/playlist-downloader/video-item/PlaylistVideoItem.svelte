<script lang="ts" module>
  const activeDownloadClicks = $state(new Set<string>());
</script>

<script lang="ts">
  import PlaylistDownloadCheckbox from "./PlaylistDownloadCheckbox.svelte";
  import PlaylistProgressRing from "./PlaylistProgressRing.svelte";
  import { createBatchState } from "./PlaylistVideoItem.batch.svelte";
  import { createButtonManager } from "./PlaylistVideoItem.buttons.svelte";
  import { createPanelManager } from "./PlaylistVideoItem.panel.svelte";
  import { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";
  import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
  import { untrack } from "svelte";

  interface Props {
    videoId: string;
    gridTitle?: string;
    isPlaylistItem?: boolean;
  }

  const { videoId, gridTitle, isPlaylistItem = false }: Props = $props();

  const isChecked = $derived(checkedPlaylistVideos.has(videoId));

  const itemState = createPlaylistVideoItemState({
    videoId: untrack(() => videoId),
    gridTitle: untrack(() => gridTitle),
    activeDownloadClicks
  });

  const batch = createBatchState({
    get videoId() {
      return videoId;
    },
    get isPlaylistItem() {
      return isPlaylistItem;
    },
    get itemState() {
      return itemState;
    }
  });

  const panel = createPanelManager(
    untrack(() => videoId),
    () => itemState.videoData,
    () => buttons.elButtonGroup,
    () => buttons.refreshChevronButton()
  );

  const buttons = createButtonManager({
    get videoId() {
      return videoId;
    },
    get itemState() {
      return itemState;
    },
    get panel() {
      return panel;
    },
    get isInProgressInZipBatch() {
      return batch.isInProgressInZipBatch;
    }
  });

  $effect(() => {
    void itemState.downloadState;
    void itemState.isDownloadFailed;
    void batch.isZipBatchActive;
    buttons.scheduleRefresh();
  });
</script>

<div class="ytdl-button-group" {@attach buttons.attachButtonGroup}>
  {#if itemState.videoData?.isDownloadable}
    <div class="ytdl-button-row" class:has-checkbox={isPlaylistItem}>
      {#if isPlaylistItem}
        <PlaylistDownloadCheckbox
          {isChecked}
          isDisabled={batch.isCheckboxDisabled}
          isIndeterminate={batch.isCheckboxIndeterminate}
          {videoId}
        />
      {/if}
      <div class="ytdl-download-btn-wrapper">
        <yt-button-view-model {@attach buttons.attachDownloadButton}></yt-button-view-model>
        {#if batch.isProgressBarVisible}
          <PlaylistProgressRing
            ariaLabel={itemState.buttonTooltip}
            isIndeterminate={batch.isProgressBarIndeterminate}
            value={batch.progressBarValue}
          />
        {/if}
      </div>
      <yt-button-view-model {@attach buttons.attachChevronButton}></yt-button-view-model>
    </div>
  {:else if !itemState.videoData && !itemState.isLoadFailed}
    <div class="ytdl-spinner-container" aria-busy="true" aria-label="Loading video info">
      <tp-yt-paper-spinner-lite active></tp-yt-paper-spinner-lite>
    </div>
  {/if}
</div>

<style>
  .ytdl-button-group {
    display: inline-flex;
    flex-direction: column;
    margin-inline-start: 8px;
  }

  .ytdl-button-row {
    position: relative;
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    &.has-checkbox {
      padding:
        calc(
          (var(--paper-checkbox-ink-size, 48px) - var(--paper-checkbox-size, 18px)) / 2
        );
    }
  }

  .ytdl-download-btn-wrapper {
    position: relative;
    display: inline-flex;
  }

  .ytdl-spinner-container {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 8px;
  }
</style>
