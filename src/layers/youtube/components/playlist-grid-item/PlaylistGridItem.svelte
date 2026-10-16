<script lang="ts">
  import { createButtonManager } from "./PlaylistGridItem.buttons.svelte";
  import { createPanelManager } from "./PlaylistGridItem.panel.svelte";
  import { createPlaylistGridItemState, PlaylistGridStatus } from "./PlaylistGridItem.state.svelte";
  import GridItemButtonGroup from "#youtube/components/playlist-downloader/GridItemButtonGroup.svelte";
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
  downloadState={state.primaryState}
  isError={state.status === PlaylistGridStatus.Failed}
  {isIndeterminate}
  {isProgressRingVisible}
  progress={state.displayProgress / 100}
  ringAriaLabel="Playlist download progress"
/>
