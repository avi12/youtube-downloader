<script lang="ts">
  import type { createPlaylistActionButtons } from "./PlaylistDownloader.action-buttons.svelte";
  import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import { applyPolymerCustomStyles, PAPER_PROGRESS_THEME } from "@/lib/polymer-utils";

  type Props = {
    playlist: ReturnType<typeof createPlaylistDownloaderState>;
    actionButtons: ReturnType<typeof createPlaylistActionButtons>;
  };

  const { playlist, actionButtons }: Props = $props();

  const isIndeterminate = $derived(
    playlist.selectedDownloadableVideos.length > 0 && !playlist.isAllSelected
  );
  const selectAllLabel = $derived(playlist.isAllSelected ? "Deselect all" : "Select all");
  const isSelectAllDisabled = $derived(playlist.downloadableVideos.length === 0);

  let elSelectAllCheckbox = $state<HTMLElement | null>(null);

  function attachSelectAllCheckbox(elCheckbox: Element) {
    if (elCheckbox instanceof HTMLElement) {
      elSelectAllCheckbox = elCheckbox;
    }
  }

  function handleSelectAllChange(e: Event) {
    if (!(e.target instanceof HTMLElement)) {
      return;
    }

    const isNowChecked = e.target.hasAttribute("checked");
    if (isNowChecked) {
      playlist.selectAll();
    } else {
      playlist.clearSelection();
    }
  }

  $effect(() => {
    if (!elSelectAllCheckbox) {
      return;
    }

    if (isIndeterminate) {
      elSelectAllCheckbox.setAttribute("indeterminate", "");
    } else {
      elSelectAllCheckbox.removeAttribute("indeterminate");
    }
  });

  function attachProgressBar(elProgress: Element) {
    applyPolymerCustomStyles(elProgress, PAPER_PROGRESS_THEME);
  }

  const progressAriaLabel = $derived.by(() => {
    if (playlist.isRevealingAll) {
      return `Loading playlist: ${playlist.revealedVideoCount} videos found`;
    }

    if (playlist.isDownloading) {
      return `Downloading ${playlist.downloadedCount} of ${playlist.totalCount} videos`;
    }

    const count = playlist.activeIndividualDownloadCount;
    return `Downloading ${count} video${count === 1 ? "" : "s"}`;
  });

  const progressAriaValueText = $derived.by(() => {
    if (playlist.isRevealingAll) {
      return `${playlist.revealedVideoCount} videos found`;
    }

    if (playlist.isDownloading) {
      return `${playlist.downloadedCount} of ${playlist.totalCount} complete`;
    }

    const count = playlist.activeIndividualDownloadCount;
    return `${count} video${count === 1 ? "" : "s"} in progress`;
  });
</script>

{#if playlist.error}
  <div class="ytdl-error-banner" role="alert">{playlist.error}</div>
{/if}

<div class="ytdl-playlist-actions">
  <div class="ytdl-select-row">
    <tp-yt-paper-checkbox
      {@attach attachSelectAllCheckbox}
      aria-label={selectAllLabel}
      checked={playlist.isAllSelected ? "" : undefined}
      disabled={isSelectAllDisabled ? "" : undefined}
      onchange={handleSelectAllChange}
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
    <span>or, skip selecting</span>
  </div>

  <yt-button-view-model {@attach actionButtons.attachDownloadAll}></yt-button-view-model>

  {#if playlist.isRevealingAll
    || (playlist.isDownloading && playlist.totalCount > 0)
    || playlist.activeIndividualDownloadCount > 0}
    <tp-yt-paper-progress
      {@attach attachProgressBar}
      aria-label={progressAriaLabel}
      aria-valuetext={progressAriaValueText}
      indeterminate={playlist.isRevealingAll || playlist.totalProgress === 0 || undefined}
      max={1}
      value={playlist.totalProgress}
    ></tp-yt-paper-progress>
  {/if}
</div>

{#if playlist.nonDownloadableCount > 0}
  <p class="ytdl-restriction-notice" role="status">
    <span class="ytdl-restriction-icon" aria-hidden="true">i</span>
    {playlist.nonDownloadableCount} video{playlist.nonDownloadableCount === 1 ? "" : "s"} not downloadable
    (private or restricted)
  </p>
{/if}

<style>
  .ytdl-error-banner {
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--yt-spec-error-indicator, rgb(204 0 0));
    color: #ffffff;
    font-size: 1.3rem;
  }

  .ytdl-playlist-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ytdl-playlist-actions :global(tp-yt-paper-progress) {
    width: 100%;
  }

  .ytdl-select-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .ytdl-selection-count {
    color: var(--yt-spec-text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-or-divider {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 4px 0;
    color: var(--yt-spec-text-secondary, #aaaaaa);
    font-size: 1.1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .ytdl-or-divider::before,
  .ytdl-or-divider::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--yt-spec-10-percent-layer, rgb(255 255 255 / 10%));
  }

  .ytdl-restriction-notice {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    color: var(--yt-spec-text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-restriction-icon {
    display: inline-flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 16px;
    height: 16px;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-family: serif;
    font-style: italic;
    font-weight: 700;
    font-size: 1.1rem;
    line-height: 1;
  }
</style>
