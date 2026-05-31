<script lang="ts">
  import { createButtonManager } from "./PlaylistGridItem.buttons.svelte";
  import { createPanelManager } from "./PlaylistGridItem.panel.svelte";
  import { createPlaylistGridItemState, PlaylistGridStatus } from "./PlaylistGridItem.state.svelte";
  import GridItemButtonGroup from "@/components/playlist-downloader/GridItemButtonGroup.svelte";
  import { untrack } from "svelte";

  interface Props {
    playlistId: string;
    gridTitle?: string;
  }

  const { playlistId, gridTitle = "" }: Props = $props();

  const state = createPlaylistGridItemState({
    playlistId: untrack(() => playlistId),
    gridTitle: untrack(() => gridTitle)
  });

  const panel = createPanelManager({
    playlistId: untrack(() => playlistId),
    state,
    getElChevronButton: () => buttons.elChevronButton,
    onChevronRefresh: () => buttons.refreshChevronButton()
  });

  const buttons = createButtonManager({
    playlistId: untrack(() => playlistId),
    state,
    panel
  });

  const isProgressRingVisible = $derived(
    state.status === PlaylistGridStatus.Fetching
    || state.status === PlaylistGridStatus.Loading
    || state.status === PlaylistGridStatus.Downloading
  );
  const isIndeterminate = $derived(state.isWorking && state.displayProgress === 0);

  $effect(() => {
    void state.status;
    void state.errorMessage;
    void panel.isOpen;
    buttons.scheduleRefresh();
  });
</script>

<GridItemButtonGroup
  attachChevronButton={buttons.attachChevronButton}
  attachDownloadButton={buttons.attachDownloadButton}
  downloadState={state.status}
  isError={state.status === PlaylistGridStatus.Failed}
  {isIndeterminate}
  {isProgressRingVisible}
  progress={state.displayProgress / 100}
  ringAriaLabel="Playlist download progress"
/>

<style>
  :global([data-ytdl-grid-item] .ytSpecButtonShapeNextMono.ytSpecButtonShapeNextTonal:not([disabled])) {
    background: var(--t7f4f2c6d54836ce0, rgb(0 0 0 / 5%));
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
  }

  :global([data-ytdl-grid-item] .ytSpecButtonShapeNextMono.ytSpecButtonShapeNextTonal:not([disabled]):hover) {
    background: var(--t416e5931fc464589, rgb(0 0 0 / 10%));
  }
</style>
