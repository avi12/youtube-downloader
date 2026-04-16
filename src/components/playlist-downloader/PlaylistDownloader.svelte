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

  let elZipInput = $state<HTMLInputElement | null>(null);

  function attachZipInput(elTarget: Element) {
    if (!(elTarget instanceof HTMLInputElement)) {
      return;
    }

    elZipInput = elTarget;
    return () => {
      elZipInput = null;
    };
  }

  $effect(() => {
    if (!elZipInput) {
      return;
    }

    elZipInput.value = playlist.effectiveZipName;
  });

  function attachScrollSyncCheckbox(elCheckbox: Element) {
    if (!(elCheckbox instanceof HTMLElement)) {
      return;
    }

    function handleCheckedChanged() {
      const isChecked = elCheckbox.hasAttribute("checked");
      if (isChecked !== playlist.isScrollSyncEnabled) {
        playlist.isScrollSyncEnabled = isChecked;
      }
    }

    elCheckbox.addEventListener("checked-changed", handleCheckedChanged);
  }

  $effect(() => {
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
        <div class="ytdl-zip-name-field">
          <input
            id="ytdl-zip-name-input"
            class="ytdl-zip-name-input"
            {@attach attachZipInput}
            aria-label="ZIP filename without extension"
            disabled={playlist.isDownloading}
            oninput={e => {
              if (!(e.target instanceof HTMLInputElement)) {
                return;
              }

              playlist.effectiveZipName = e.target.value;
            }}
            type="text"
          />
          <span class="ytdl-zip-ext" aria-hidden="true">.zip</span>
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

  <section class="ytdl-section" aria-labelledby="ytdl-scroll-sync-label">
    <h3 id="ytdl-scroll-sync-label" class="ytdl-section-title">While downloading</h3>
    <tp-yt-paper-checkbox
      {@attach attachScrollSyncCheckbox}
      checked={playlist.isScrollSyncEnabled ? "" : undefined}
    >
      Scroll to the current video
    </tp-yt-paper-checkbox>
    <span class="ytdl-scroll-sync-hint">
      Scrolls to each video as it downloads - works with both download options
    </span>
  </section>

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
    background: var(--yt-spec-raised-background, var(--yt-spec-base-background, #ffffff));
    color: var(--yt-spec-text-primary, #0f0f0f);
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

  :global(.ytdl-playlist-container tp-yt-paper-checkbox) {
    font-size: 1.4rem;
  }

  .ytdl-scroll-sync-hint {
    color: var(--yt-spec-text-secondary, #aaaaaa);
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
    color: var(--yt-spec-text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-zip-name-field {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .ytdl-zip-name-input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgb(255 255 255 / 10%));
    border-radius: 4px;
    background: transparent;
    color: var(--yt-spec-text-primary, #0f0f0f);
    font-family: inherit;
    font-size: 1.3rem;

    &:focus {
      border-color: var(--yt-spec-call-to-action, #3ea6ff);
      outline: none;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }
  }

  .ytdl-zip-ext {
    color: var(--yt-spec-text-secondary, #aaaaaa);
    font-size: 1.3rem;
    white-space: nowrap;
  }
</style>
