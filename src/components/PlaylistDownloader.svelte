<script lang="ts">
  import { createPlaylistActionButtons } from "./PlaylistDownloader.action-buttons.svelte";
  import { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import { createPlaylistToggleButtons } from "./PlaylistDownloader.toggle-buttons.svelte";
  import PlaylistDownloaderActions from "./PlaylistDownloaderActions.svelte";
  import PlaylistDownloaderFormatSections from "./PlaylistDownloaderFormatSections.svelte";
  import { buttonClickSignal } from "@/lib/synced-stores.svelte";
  import type { Options } from "@/types";
  import { untrack } from "svelte";

  type Props = { options: Options };

  const { options }: Props = $props();
  const playlist = createPlaylistDownloaderState(() => options);

  const toggleButtons = createPlaylistToggleButtons(playlist);
  const actionButtons = createPlaylistActionButtons(playlist);

  $effect(() => {
    void playlist.downloadMode;
    void playlist.outputMode;
    void playlist.effectiveDownloadType;
    toggleButtons.refreshAll();
  });

  $effect(() => {
    void playlist.downloadableVideos.length;
    void playlist.isAllSelected;
    actionButtons.refreshSelectAll();
  });

  $effect(() => {
    void playlist.selectedDownloadableVideos.length;
    void playlist.isDownloading;
    void playlist.downloadButtonLabel;
    actionButtons.refreshDownload();
  });

  $effect(() => {
    void playlist.isRevealingAll;
    void playlist.isDownloading;
    void playlist.revealedVideoCount;
    actionButtons.refreshDownloadAll();
  });

  $effect(() => {
    const clicked = buttonClickSignal.value;
    if (!clicked?.buttonId) {
      return;
    }

    // Dispatch reads must be untracked; otherwise the effect re-runs after the click
    // mutates state and re-executes the same branch with inverted logic.
    untrack(() => {
      if (actionButtons.handleClick(clicked.buttonId)) {
        return;
      }

      toggleButtons.handleClick(clicked.buttonId);
    });
  });
</script>

<tp-yt-paper-card class="ytdl-playlist-container" aria-label="Playlist Downloader" elevation="1" role="region">
  <section class="ytdl-section" aria-labelledby="ytdl-speed-label">
    <yt-formatted-string
      id="ytdl-speed-label"
      class="ytdl-section-title"
      aria-level="3"
      role="heading"
    >Speed</yt-formatted-string>
    <div class="ytdl-chip-row" aria-labelledby="ytdl-speed-label" role="group">
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[0])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[1])}></yt-button-view-model>
    </div>
  </section>

  <section class="ytdl-section" aria-labelledby="ytdl-output-label">
    <yt-formatted-string
      id="ytdl-output-label"
      class="ytdl-section-title"
      aria-level="3"
      role="heading"
    >Output</yt-formatted-string>
    <div class="ytdl-chip-row" aria-labelledby="ytdl-output-label" role="group">
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[2])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[3])}></yt-button-view-model>
    </div>
  </section>

  <section class="ytdl-section" aria-labelledby="ytdl-type-label">
    <yt-formatted-string
      id="ytdl-type-label"
      class="ytdl-section-title"
      aria-level="3"
      role="heading"
    >
      Type
      {#if playlist.isDownloadTypeOverridden}
        <span class="ytdl-override-badge" role="status">
          <span class="ytdl-override-dot" aria-hidden="true"></span>
          <span class="ytdl-visually-hidden">customized</span>
        </span>
      {/if}
    </yt-formatted-string>
    <div class="ytdl-chip-row ytdl-chip-row-wrap" aria-labelledby="ytdl-type-label" role="group">
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[4])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[5])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[6])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[7])}></yt-button-view-model>
    </div>
  </section>

  <PlaylistDownloaderFormatSections {playlist} />

  <PlaylistDownloaderActions {actionButtons} {playlist} />
</tp-yt-paper-card>

<style>
  .ytdl-playlist-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 12px 0;
    padding: 12px 16px;
  }

  :global(.ytdl-section) {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
    transition: opacity 150ms ease;

    & + & {
      border-top: 1px solid var(--yt-spec-10-percent-layer, rgb(255 255 255 / 10%));
    }
  }

  .ytdl-section-title {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }

  .ytdl-chip-row {
    display: flex;
    gap: 6px;
  }

  .ytdl-chip-row-wrap {
    flex-wrap: wrap;
  }
</style>
