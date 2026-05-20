<script lang="ts">
  import type { createPlaylistActionButtons } from "./PlaylistDownloader.action-buttons.svelte";
  import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import PlaylistScrollSyncToggle from "./PlaylistScrollSyncToggle.svelte";

  interface Props {
    playlist: ReturnType<typeof createPlaylistDownloaderState>;
    actionButtons: ReturnType<typeof createPlaylistActionButtons>;
  }

  const { playlist, actionButtons }: Props = $props();

  const hasSomeSelected = $derived(playlist.selectedDownloadableVideos.length > 0);
  const isIndeterminate = $derived(hasSomeSelected && !playlist.isAllSelected);
  const selectAllLabel = $derived(playlist.isAllSelected ? "Deselect all" : "Select all loaded");
  const isNoVideosAvailable = $derived(playlist.downloadableVideos.length === 0);
  const isSelectAllDisabled = $derived(isNoVideosAvailable || playlist.isDownloading);

  let elSelectAllCheckbox = $state<HTMLElement | null>(null);

  function attachSelectAllCheckbox(elCheckbox: Element): void {
    if (elCheckbox instanceof HTMLElement) {
      elSelectAllCheckbox = elCheckbox;
    }
  }

  $effect(() => {
    if (!elSelectAllCheckbox) {
      return;
    }

    if (isIndeterminate) {
      elSelectAllCheckbox.setAttribute("indeterminate", "");
      elSelectAllCheckbox.setAttribute("aria-checked", "mixed");
      return;
    }

    elSelectAllCheckbox.removeAttribute("indeterminate");
    elSelectAllCheckbox.setAttribute("aria-checked", playlist.isAllSelected ? "true" : "false");
  });
</script>

<div class="ytdl-select-row">
  <tp-yt-paper-checkbox
    {@attach attachSelectAllCheckbox}
    aria-label={selectAllLabel}
    checked={(playlist.isAllSelected || isIndeterminate) ? "" : undefined}
    disabled={isSelectAllDisabled ? "" : undefined}
    onchange={e => {
      if (!(e.target instanceof HTMLElement)) {
        return;
      }

      const isNowChecked = e.target.hasAttribute("checked");
      if (isNowChecked) {
        playlist.selectAll();
      } else {
        playlist.clearSelection();
      }
    }}
  >
    {selectAllLabel}
  </tp-yt-paper-checkbox>
  <yt-button-view-model {@attach actionButtons.attachDeselectAll}></yt-button-view-model>
</div>

<span class="ytdl-selection-count" aria-live="polite">
  {playlist.selectedDownloadableVideos.length} of {playlist.downloadableVideos.length}
  video{playlist.downloadableVideos.length === 1 ? "" : "s"} selected
</span>

<yt-button-view-model {@attach actionButtons.attachDownload}></yt-button-view-model>

<div class="ytdl-or-divider" aria-hidden="true">
  <span>or</span>
</div>

<yt-button-view-model {@attach actionButtons.attachDownloadAll}></yt-button-view-model>

<PlaylistScrollSyncToggle
  isEnabled={playlist.isScrollSyncEnabled}
  ontoggle={value => (playlist.isScrollSyncEnabled = value)}
/>

<style>
  .ytdl-select-row {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    align-items: center;
  }

  .ytdl-selection-count {
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-or-divider {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 4px 0;
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;

    &::before,
    &::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--yt-sys-color-baseline--tonal-rim, rgb(255 255 255 / 10%));
    }
  }
</style>
