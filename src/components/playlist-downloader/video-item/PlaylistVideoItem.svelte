<script lang="ts" module>
  const activeDownloadClicks = $state(new Set<string>());
</script>

<script lang="ts">
  import PlaylistDownloadCheckbox from "./PlaylistDownloadCheckbox.svelte";
  import { createBatchState } from "./PlaylistVideoItem.batch.svelte";
  import { createButtonManager } from "./PlaylistVideoItem.buttons.svelte";
  import { createPanelManager } from "./PlaylistVideoItem.panel.svelte";
  import { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";
  import GridItemButtonGroup from "@/components/playlist-downloader/GridItemButtonGroup.svelte";
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

  const panel = createPanelManager({
    videoId: untrack(() => videoId),
    getVideoData: () => itemState.videoData,
    getElChevronButton: () => buttons.elChevronButton,
    getElButtonGroup: () => buttons.elButtonGroup,
    onChevronRefresh: () => buttons.refreshChevronButton()
  });

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
    get isInBatch() {
      return batch.isInBatch;
    },
    get isInProgressInZipBatch() {
      return batch.isInProgressInZipBatch;
    }
  });

  $effect(() => {
    void itemState.downloadState;
    void itemState.isDownloadFailed;
    void itemState.isLoadFailed;
    void batch.isZipBatchActive;
    buttons.scheduleRefresh();
  });
</script>

<GridItemButtonGroup
  attachButtonGroup={buttons.attachButtonGroup}
  attachChevronButton={buttons.attachChevronButton}
  attachDownloadButton={buttons.attachDownloadButton}
  downloadState={itemState.downloadStateClass}
  hasCheckbox={isPlaylistItem}
  isError={itemState.isDownloadFailed}
  isIndeterminate={itemState.isIndeterminate}
  isLoadFailed={itemState.isLoadFailed}
  isProgressRingVisible={itemState.isProgressRingVisible}
  isReady={!!(itemState.videoData?.isDownloadable || itemState.isLoadFailed)}
  progress={itemState.effectiveProgress}
  ringAriaLabel={itemState.buttonTooltip}
>
  {#if isPlaylistItem}
    <PlaylistDownloadCheckbox
      {isChecked}
      isDisabled={batch.isCheckboxDisabled}
      isIndeterminate={batch.isCheckboxIndeterminate}
      {videoId}
    />
  {/if}
</GridItemButtonGroup>
