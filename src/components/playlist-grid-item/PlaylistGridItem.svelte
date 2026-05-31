<script lang="ts">
  import { createButtonManager } from "./PlaylistGridItem.buttons.svelte";
  import { createPanelManager } from "./PlaylistGridItem.panel.svelte";
  import { createPlaylistGridItemState, PlaylistGridStatus } from "./PlaylistGridItem.state.svelte";
  import DownloadProgressRing from "@/components/download-button/DownloadProgressRing.svelte";
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

<div class="ytdl-button-group">
  <div class="ytdl-button-row" data-ytdl-download-state={state.status}>
    <div class="ytdl-download-btn-wrapper">
      <yt-button-view-model {@attach buttons.attachDownloadButton}></yt-button-view-model>
      <div class="ytdl-playlist-ring-slot" class:is-visible={isProgressRingVisible}>
        <DownloadProgressRing
          ariaLabel="Playlist download progress"
          isError={state.status === PlaylistGridStatus.Failed}
          {isIndeterminate}
          progress={state.displayProgress / 100}
        />
      </div>
    </div>
    <yt-button-view-model {@attach buttons.attachChevronButton}></yt-button-view-model>
  </div>
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
  }

  .ytdl-download-btn-wrapper {
    position: relative;
    display: inline-flex;
  }

  .ytdl-playlist-ring-slot {
    position: absolute;
    inset: -8px;
    opacity: 0%;
    pointer-events: none;
    transition: opacity 120ms ease-out;

    &.is-visible {
      opacity: 100%;
    }
  }

  :global([data-ytdl-grid-item] .ytSpecButtonShapeNextMono.ytSpecButtonShapeNextTonal:not([disabled])) {
    background: var(--t7f4f2c6d54836ce0, rgb(0 0 0 / 5%));
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
  }

  :global([data-ytdl-grid-item] .ytSpecButtonShapeNextMono.ytSpecButtonShapeNextTonal:not([disabled]):hover) {
    background: var(--t416e5931fc464589, rgb(0 0 0 / 10%));
  }
</style>
