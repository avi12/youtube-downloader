<script lang="ts">
  import { createPlaylistActionButtons } from "./PlaylistDownloader.action-buttons.svelte";
  import { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import { createPlaylistToggleButtons } from "./PlaylistDownloader.toggle-buttons.svelte";
  import PlaylistDownloaderActions from "./PlaylistDownloaderActions.svelte";
  import PlaylistDownloaderFormatSections from "./PlaylistDownloaderFormatSections.svelte";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { PlaylistOutputMode } from "@/types";
  import { untrack } from "svelte";

  const playlist = createPlaylistDownloaderState();

  const toggleButtons = createPlaylistToggleButtons(playlist);
  const actionButtons = createPlaylistActionButtons(playlist);

  $effect.pre(() => {
    void playlist.downloadMode;
    void playlist.outputMode;
    void playlist.effectiveDownloadType;
    void playlist.isDownloading;
    toggleButtons.refreshAll();
  });

  $effect(() => {
    void playlist.selectedDownloadableVideos.length;
    void playlist.isDownloading;
    actionButtons.refreshDeselectAll();
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
    void playlist.activeIndividualDownloadCount;
    actionButtons.refreshDownloadAll();
  });

  $effect(() => {
    void playlist.isDownloading;
    actionButtons.refreshStopAll();
  });

  $effect(() => onButtonClick(buttonId => {
    untrack(() => {
      if (actionButtons.handleClick(buttonId)) {
        return;
      }

      toggleButtons.handleClick(buttonId);
    });
  }));
</script>

<section class="ytdl-playlist-container" aria-label="Playlist Downloader">
  <section class="ytdl-section">
    <h3 class="ytdl-section-title">
      Download playlist
      {#if playlist.isDownloading}
        <yt-button-view-model {@attach actionButtons.attachStopAll}></yt-button-view-model>
      {/if}
    </h3>
    {#if playlist.isDownloading}
      <span class="ytdl-scroll-sync-hint" aria-live="polite">
        {playlist.downloadedCount} of {playlist.totalCount} videos saved
      </span>
    {/if}
  </section>

  {#if !playlist.isDownloading}
    <section class="ytdl-section" aria-labelledby="ytdl-speed-label">
      <h3 id="ytdl-speed-label" class="ytdl-section-title">Speed</h3>
      <div class="ytdl-chip-row" aria-labelledby="ytdl-speed-label" role="group">
        {#each toggleButtons.groups.speed as button (button.id)}
          <yt-button-view-model {@attach toggleButtons.createAttacher(button)}></yt-button-view-model>
        {/each}
      </div>
    </section>

    <section class="ytdl-section" aria-labelledby="ytdl-output-label">
      <h3 id="ytdl-output-label" class="ytdl-section-title">Output</h3>
      <div class="ytdl-chip-row" aria-labelledby="ytdl-output-label" role="group">
        {#each toggleButtons.groups.output as button (button.id)}
          <yt-button-view-model {@attach toggleButtons.createAttacher(button)}></yt-button-view-model>
        {/each}
      </div>
      {#if playlist.outputMode === PlaylistOutputMode.Zip}
        <div class="ytdl-zip-name">
          <label class="ytdl-zip-name-label" for="ytdl-zip-name-input">Filename</label>
          <div class="ytdl-zip-name-row">
            <div class="ytdl-zip-name-field">
              <input
                id="ytdl-zip-name-input"
                class="ytdl-zip-name-input"
                aria-label="ZIP filename without extension"
                dir="auto"
                disabled={playlist.isDownloading}
                oninput={e => {
                  if (!(e.target instanceof HTMLInputElement)) {
                    return;
                  }

                  playlist.effectiveZipName = e.target.value;
                }}
                spellcheck={false}
                type="text"
                value={playlist.effectiveZipName}
              />
              <span class="ytdl-zip-ext" aria-hidden="true"></span>
            </div>
            {#if playlist.isZipNameOverridden}
              <span class="ytdl-override-badge" role="status">
                <span class="ytdl-override-dot" aria-hidden="true"></span>
                <span class="ytdl-visually-hidden">customized</span>
              </span>
            {/if}
          </div>
        </div>
      {/if}
    </section>

    <section class="ytdl-section" aria-labelledby="ytdl-type-label">
      <h3 id="ytdl-type-label" class="ytdl-section-title">
        Type
        {#if playlist.isDownloadTypeOverridden}
          <span class="ytdl-override-badge" role="status">
            <span class="ytdl-override-dot" aria-hidden="true"></span>
            <span class="ytdl-visually-hidden">customized</span>
          </span>
        {/if}
      </h3>
      <div class="ytdl-chip-row ytdl-chip-row-wrap" aria-labelledby="ytdl-type-label" role="group">
        {#each toggleButtons.groups.type as button (button.id)}
          <yt-button-view-model {@attach toggleButtons.createAttacher(button)}></yt-button-view-model>
        {/each}
      </div>
    </section>

    <PlaylistDownloaderFormatSections {playlist} />
  {/if}

  <PlaylistDownloaderActions {actionButtons} {playlist} />
</section>

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
  }

  .ytdl-scroll-sync-hint {
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-section-title {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    font-weight: 500;
    font-size: 1.4rem;
    line-height: 1.2;
  }

  .ytdl-chip-row {
    display: flex;
    gap: 6px;
  }

  .ytdl-chip-row-wrap {
    flex-wrap: wrap;
  }

  .ytdl-zip-name {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ytdl-zip-name-label {
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-zip-name-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  /* The shared underlined container that makes input + .zip look like one field */
  .ytdl-zip-name-field {
    --zip-inset-start: auto;
    --zip-inset-end: 0px;
    --zip-padding-start: 0;
    --zip-padding-end: 1.6em;
    --zip-label: ".zip";

    position: relative;
    display: flex;
    flex: 1;
    border-bottom: 1px solid var(--yt-sys-color-baseline--text-secondary, #aaaaaa);

    &:has(:dir(rtl)) {
      --zip-inset-start: 0px;
      --zip-inset-end: auto;
      --zip-padding-start: 1.6em;
      --zip-padding-end: 0;
      --zip-label: "zip.";
    }

    &:focus-within {
      border-bottom: 2px solid var(--yt-sys-color-baseline--call-to-action, rgb(62 166 255));
    }

    &:has(input:disabled) {
      opacity: 38%;
      cursor: not-allowed;
    }
  }

  .ytdl-zip-name-input {
    flex: 1;
    min-width: 0;
    padding-block: 2px 4px;
    padding-inline-end: var(--zip-padding-end);
    padding-inline-start: var(--zip-padding-start);
    border: none;
    background: transparent;
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    outline: none;
    font-family: inherit;
    font-size: 1.4rem;

    &:disabled {
      cursor: not-allowed;
    }
  }

  .ytdl-zip-ext {
    position: absolute;
    inset-block: 0;
    inset-inline-end: var(--zip-inset-end);
    inset-inline-start: var(--zip-inset-start);
    display: flex;
    align-items: flex-end;
    padding-block-end: 4px;
    padding-inline-end: 2px;
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.4rem;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;

    &::before {
      content: var(--zip-label);
    }
  }
</style>
