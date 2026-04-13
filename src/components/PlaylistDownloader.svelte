<script lang="ts">
  import { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import { createPlaylistToggleButtons } from "./PlaylistDownloader.toggle-buttons.svelte";
  import PolymerSelect from "./PolymerSelect.svelte";
  import { AUTO_EXTENSION, AUTO_EXTENSION_LABEL, supportedExtensions } from "@/lib/containers";
  import { applyPolymerCustomStyles, PAPER_PROGRESS_THEME, sendButtonData } from "@/lib/polymer-utils";
  import { buttonClickSignal } from "@/lib/synced-stores.svelte";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    DownloadType,
    IconName,
    PlaylistDownloadMode
  } from "@/types";
  import type { Options } from "@/types";
  import { untrack } from "svelte";

  type Props = { options: Options };

  const { options }: Props = $props();
  const playlist = createPlaylistDownloaderState(() => options);

  const toggleButtons = createPlaylistToggleButtons(playlist);

  const DOWNLOAD_BUTTON_ID = "playlist-download-btn";
  const DOWNLOAD_ALL_BUTTON_ID = "playlist-download-all-btn";
  const SELECT_ALL_BUTTON_ID = "playlist-select-all-btn";

  let elSelectAllButton = $state<HTMLElement | null>(null);
  let elDownloadButton = $state<HTMLElement | null>(null);
  let elDownloadAllButton = $state<HTMLElement | null>(null);

  $effect(() => {
    void playlist.downloadMode;
    void playlist.outputMode;
    toggleButtons.refreshAll();
  });

  $effect(() => {
    if (!elSelectAllButton) {
      return;
    }

    const hasAny = playlist.downloadableVideos.length > 0;
    const label = playlist.isAllSelected ? "Clear selection" : "Check all loaded";
    const tooltip = playlist.isAllSelected
      ? "Uncheck every video in this list"
      : "Check every video currently loaded in this list (scroll down to load more)";
    sendButtonData(elSelectAllButton, {
      iconName: IconName.None,
      title: label,
      accessibilityText: label,
      style: ButtonStyle.Mono,
      type: playlist.isAllSelected ? ButtonType.Tonal : ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: hasAny ? ButtonState.Active : ButtonState.Disabled,
      isFullWidth: false,
      isDisabled: !hasAny,
      tooltip
    });
  });

  $effect(() => {
    if (!elDownloadButton) {
      return;
    }

    const isDisabled = playlist.selectedDownloadableVideos.length === 0 && !playlist.isDownloading;
    sendButtonData(elDownloadButton, {
      iconName: playlist.isDownloading ? IconName.Close : IconName.Download,
      title: playlist.downloadButtonLabel,
      accessibilityText: playlist.downloadButtonLabel,
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip: playlist.downloadButtonLabel
    });
  });

  $effect(() => {
    if (!elDownloadAllButton) {
      return;
    }

    const isBusy = playlist.isRevealingAll || playlist.isDownloading;
    const downloadAllLabel = playlist.isRevealingAll
      ? `Revealing hidden videos (${playlist.revealedVideoCount})`
      : "Grab the whole playlist";
    const downloadAllTooltip = playlist.isRevealingAll
      ? "Stop loading the rest of the playlist"
      : "Scroll through the playlist to reveal any hidden videos, then download every one (ignores the checkboxes)";

    sendButtonData(elDownloadAllButton, {
      iconName: playlist.isRevealingAll ? IconName.Close : IconName.PlaylistAdd,
      title: downloadAllLabel,
      accessibilityText: downloadAllLabel,
      style: ButtonStyle.Mono,
      type: ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: isBusy && !playlist.isRevealingAll ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled: isBusy && !playlist.isRevealingAll,
      tooltip: downloadAllTooltip
    });
  });

  function attachSelectAllButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute("data-ytdl-button-id", SELECT_ALL_BUTTON_ID);
    elSelectAllButton = elButton;
  }

  function attachDownloadButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute("data-ytdl-button-id", DOWNLOAD_BUTTON_ID);
    elDownloadButton = elButton;
  }

  function attachDownloadAllButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elButton.setAttribute("data-ytdl-button-id", DOWNLOAD_ALL_BUTTON_ID);
    elDownloadAllButton = elButton;
  }

  function attachProgressBar(elProgress: Element) {
    applyPolymerCustomStyles(elProgress, PAPER_PROGRESS_THEME);
  }

  function attachScrollSyncCheckbox(elCheckbox: Element) {
    if (!(elCheckbox instanceof HTMLElement)) {
      return;
    }

    function readCheckedAttribute() {
      return elCheckbox.hasAttribute("checked");
    }

    function handleCheckedChanged() {
      const nextChecked = readCheckedAttribute();
      if (nextChecked !== playlist.isScrollSyncEnabled) {
        playlist.isScrollSyncEnabled = nextChecked;
      }
    }

    elCheckbox.addEventListener("checked-changed", handleCheckedChanged);
  }

  $effect(() => {
    const clicked = buttonClickSignal.value;
    if (!clicked?.buttonId) {
      return;
    }

    // State reads inside the dispatcher must be untracked; otherwise the effect re-runs
    // when the click mutates state and re-executes the same branch with inverted logic.
    untrack(() => {
      if (clicked.buttonId === DOWNLOAD_BUTTON_ID) {
        playlist.toggleSelectedDownload();
        return;
      }

      if (clicked.buttonId === DOWNLOAD_ALL_BUTTON_ID) {
        if (playlist.isRevealingAll) {
          playlist.cancelReveal();
        } else {
          void playlist.revealAndDownloadAll();
        }

        return;
      }

      if (clicked.buttonId === SELECT_ALL_BUTTON_ID) {
        if (playlist.isAllSelected) {
          playlist.clearSelection();
        } else {
          playlist.selectAll();
        }

        return;
      }

      toggleButtons.handleClick(clicked.buttonId);
    });
  });

  const isDataSaverSelected = $derived(playlist.downloadMode === PlaylistDownloadMode.DataSaver);

  function formatExtensionLabel(extension: string) {
    return extension === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : extension.toUpperCase();
  }

  const videoExtOptions = $derived(
    supportedExtensions.video.map(extension => ({ value: extension, label: formatExtensionLabel(extension) }))
  );
  const audioExtOptions = $derived(
    supportedExtensions.audio.map(extension => ({ value: extension, label: formatExtensionLabel(extension) }))
  );

  const isVideoExtDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Audio);
  const isAudioExtDisabled = $derived(playlist.effectiveDownloadType === DownloadType.Video);

  function handleVideoExtChange(value: string) {
    playlist.effectiveVideoExt = value;
  }

  function handleAudioExtChange(value: string) {
    playlist.effectiveAudioExt = value;
  }
</script>

<div class="ytdl-playlist-container" aria-label="Playlist Downloader" role="region">
  {#if playlist.error}
    <div class="ytdl-error-banner" role="alert">{playlist.error}</div>
  {/if}

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
        <span class="ytdl-override-dot" aria-hidden="true" title="Different from your default"></span>
      {/if}
    </yt-formatted-string>
    <div class="ytdl-chip-row ytdl-chip-row-wrap" aria-labelledby="ytdl-type-label" role="group">
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[4])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[5])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[6])}></yt-button-view-model>
      <yt-button-view-model {@attach toggleButtons.createAttacher(toggleButtons.buttons[7])}></yt-button-view-model>
    </div>
  </section>

  <section class="ytdl-section ytdl-section-select" class:is-disabled={isVideoExtDisabled}>
    <PolymerSelect
      id="playlist-video-ext"
      disabled={isVideoExtDisabled}
      label="Video format"
      onchange={handleVideoExtChange}
      options={videoExtOptions}
      value={playlist.effectiveVideoExt}
    />
    {#if playlist.isVideoExtOverridden}
      <span
        class="ytdl-override-dot ytdl-override-dot-floating"
        aria-hidden="true"
        title="Different from your default"
      ></span>
    {/if}
  </section>

  <section class="ytdl-section ytdl-section-select" class:is-disabled={isAudioExtDisabled}>
    <PolymerSelect
      id="playlist-audio-ext"
      disabled={isAudioExtDisabled}
      label="Audio format"
      onchange={handleAudioExtChange}
      options={audioExtOptions}
      value={playlist.effectiveAudioExt}
    />
    {#if playlist.isAudioExtOverridden}
      <span
        class="ytdl-override-dot ytdl-override-dot-floating"
        aria-hidden="true"
        title="Different from your default"
      ></span>
    {/if}
  </section>

  {#if playlist.hasAnyOverride}
    <button class="ytdl-reset-link" onclick={playlist.resetOverrides} type="button">
      Reset to my defaults
    </button>
  {/if}

  <div class="ytdl-playlist-actions">
    <div class="ytdl-selection-row">
      <yt-button-view-model {@attach attachSelectAllButton}></yt-button-view-model>
      <span class="ytdl-selection-count" aria-live="polite">
        {playlist.selectedDownloadableVideos.length} of {playlist.downloadableVideos.length}
        video{playlist.downloadableVideos.length === 1 ? "" : "s"} selected
      </span>
    </div>
    <yt-button-view-model {@attach attachDownloadButton}></yt-button-view-model>

    <div class="ytdl-or-divider" aria-hidden="true">
      <span>or, skip selecting</span>
    </div>

    <yt-button-view-model {@attach attachDownloadAllButton}></yt-button-view-model>

    {#if playlist.isDownloading && playlist.totalCount > 0}
      <tp-yt-paper-progress
        {@attach attachProgressBar}
        max={playlist.totalCount}
        value={playlist.downloadedCount}
      ></tp-yt-paper-progress>
    {/if}
  </div>

  <div class="ytdl-scroll-sync-option" class:is-disabled={!isDataSaverSelected}>
    <tp-yt-paper-checkbox
      {@attach attachScrollSyncCheckbox}
      checked={playlist.isScrollSyncEnabled ? "" : undefined}
      disabled={!isDataSaverSelected ? "" : undefined}
    >
      Scroll to currently-downloading video
    </tp-yt-paper-checkbox>
  </div>

  {#if playlist.nonDownloadableCount > 0}
    <p class="ytdl-restriction-notice" role="status">
      <span class="ytdl-restriction-icon" aria-hidden="true">i</span>
      {playlist.nonDownloadableCount} video{playlist.nonDownloadableCount === 1 ? "" : "s"} not downloadable
      (private or restricted)
    </p>
  {/if}
</div>

<style>
  .ytdl-playlist-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
  }

  .ytdl-section {
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

  .ytdl-override-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--yt-spec-call-to-action, #3ea6ff);
  }

  .ytdl-section.is-disabled {
    opacity: 50%;
    pointer-events: none;
  }

  .ytdl-section-select {
    position: relative;
  }

  .ytdl-override-dot-floating {
    position: absolute;
    top: 14px;
    right: -12px;
  }

  .ytdl-reset-link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--yt-spec-call-to-action, #3ea6ff);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  .ytdl-playlist-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ytdl-selection-row {
    display: flex;
    gap: 12px;
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

  .ytdl-error-banner {
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--yt-spec-error-indicator, rgb(204 0 0));
    color: #ffffff;
    font-size: 1.3rem;
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

  .ytdl-scroll-sync-option {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 1.2rem;
    cursor: pointer;
    transition: opacity 200ms ease;
  }

  .ytdl-scroll-sync-option.is-disabled {
    opacity: 50%;
    cursor: not-allowed;
  }
</style>
