<script lang="ts">
  import { createPlaylistActionButtons } from "./PlaylistDownloader.action-buttons.svelte";
  import { setupPlaylistEffects } from "./PlaylistDownloader.effects.svelte";
  import { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import { createPlaylistToggleButtons } from "./PlaylistDownloader.toggle-buttons.svelte";
  import PlaylistDownloaderActions from "./PlaylistDownloaderActions.svelte";
  import PlaylistDownloaderFormatSections from "./PlaylistDownloaderFormatSections.svelte";
  import PlaylistDownloaderSettings from "./PlaylistDownloaderSettings.svelte";
  import { attachFormattedString } from "@/lib/ui/polymer-utils";

  const playlist = createPlaylistDownloaderState();
  const toggleButtons = createPlaylistToggleButtons(playlist);
  const actionButtons = createPlaylistActionButtons(playlist);

  setupPlaylistEffects(playlist, toggleButtons, actionButtons);
</script>

<div class="ytdl-playlist-container">
  <div class="ytdl-section">
    <div class="ytdl-section-title">
      <yt-formatted-string {@attach attachFormattedString("Download playlist")}></yt-formatted-string>
      {#if playlist.isDownloading}
        <yt-button-view-model {@attach actionButtons.attachStopAll}></yt-button-view-model>
      {/if}
    </div>
    {#if playlist.isDownloading}
      <span class="ytdl-scroll-sync-hint" aria-live="polite">
        {playlist.downloadedCount} of {playlist.totalCount} videos saved
      </span>
    {/if}
  </div>

  {#if !playlist.isDownloading}
    <PlaylistDownloaderSettings {playlist} {toggleButtons} />
    <PlaylistDownloaderFormatSections {playlist} />
  {/if}

  <PlaylistDownloaderActions {actionButtons} {playlist} />
</div>

<style>
  .ytdl-playlist-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0;
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--yt-sys-color-baseline--raised-background, var(--yt-sys-color-baseline--base-background, #ffffff));
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
  }

  :global {
    .ytdl-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 0;
      transition: opacity 150ms ease;

      & + & {
        border-top: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(255 255 255 / 10%));
      }
    }

    .ytdl-playlist-container tp-yt-paper-checkbox {
      font-size: 1.4rem;
    }

    .ytdl-playlist-container ytd-settings-options-renderer #section {
      flex-direction: column !important;
      gap: 8px !important;
      padding: 0 !important;
    }
  }

  .ytdl-scroll-sync-hint {
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-section-title {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    font-weight: 500;
    font-size: 1.4rem;
    line-height: 1.2;
  }
</style>
