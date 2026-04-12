<script lang="ts">
  /**
   * Playlist-level download button.
   * Appears in the playlist header and allows downloading all checked videos.
   */
  import { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
  import { applyPolymerCustomStyles, PAPER_PROGRESS_THEME, sendButtonData } from "@/lib/polymer-utils";
  import { buttonClickSignal } from "@/lib/synced-stores.svelte";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    IconName,
    PlaylistDownloadMode,
    PlaylistOutputMode
  } from "@/types";
  import type { Options } from "@/types";
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";

  type Props = { options: Options };

  const { options }: Props = $props();
  const state = createPlaylistDownloaderState(() => options);

  // ─── Toggle buttons (mode + output) — single DRY factory ─────────────────────

  type ToggleButtonConfig = {
    id: string;
    label: string;
    tooltip: string;
    isActive(): boolean;
    onClick(): void;
  };

  function setDownloadMode(mode: PlaylistDownloadMode) {
    state.downloadMode = mode;
  }

  function setOutputMode(mode: PlaylistOutputMode) {
    state.outputMode = mode;
  }

  const toggleButtons: ToggleButtonConfig[] = [
    {
      id: "playlist-mode-fast",
      label: "Fast",
      tooltip: "Download all videos simultaneously",
      isActive: () => state.downloadMode === PlaylistDownloadMode.Fast,
      onClick: () => setDownloadMode(PlaylistDownloadMode.Fast)
    },
    {
      id: "playlist-mode-data-saver",
      label: "Data saver",
      tooltip: "Download videos one at a time to save bandwidth",
      isActive: () => state.downloadMode === PlaylistDownloadMode.DataSaver,
      onClick: () => setDownloadMode(PlaylistDownloadMode.DataSaver)
    },
    {
      id: "playlist-output-individual",
      label: "Individual files",
      tooltip: "Save each video as a separate file",
      isActive: () => state.outputMode === PlaylistOutputMode.Individual,
      onClick: () => setOutputMode(PlaylistOutputMode.Individual)
    },
    {
      id: "playlist-output-zip",
      label: "ZIP bundle",
      tooltip: "Bundle all videos into a single ZIP file",
      isActive: () => state.outputMode === PlaylistOutputMode.Zip,
      onClick: () => setOutputMode(PlaylistOutputMode.Zip)
    }
  ];

  const toggleButtonElements = new SvelteMap<string, HTMLElement>();

  function refreshToggleButton(config: ToggleButtonConfig) {
    const elButton = toggleButtonElements.get(config.id);
    if (!elButton) {
      return;
    }

    if (!elButton.hasAttribute("data-ytdl-button-id")) {
      elButton.setAttribute("data-ytdl-button-id", config.id);
    }

    sendButtonData(elButton, {
      iconName: IconName.None,
      title: config.label,
      accessibilityText: config.label,
      style: ButtonStyle.Mono,
      type: config.isActive() ? ButtonType.Tonal : ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: ButtonState.Active,
      isFullWidth: false,
      isDisabled: false,
      tooltip: config.tooltip
    });
  }

  function refreshAllToggleButtons() {
    for (const config of toggleButtons) {
      refreshToggleButton(config);
    }
  }

  function createToggleAttacher(config: ToggleButtonConfig) {
    return (elButton: Element) => {
      if (!(elButton instanceof HTMLElement)) {
        return;
      }

      toggleButtonElements.set(config.id, elButton);
      refreshToggleButton(config);
    };
  }

  $effect(() => {
    void state.downloadMode;
    void state.outputMode;
    refreshAllToggleButtons();
  });

  // ─── Download button ─────────────────────────────────────────────────────────

  const DOWNLOAD_BUTTON_ID = "playlist-download-btn";
  const DOWNLOAD_ALL_BUTTON_ID = "playlist-download-all-btn";
  const SELECT_ALL_BUTTON_ID = "playlist-select-all-btn";

  function attachSelectAllButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    if (!elButton.hasAttribute("data-ytdl-button-id")) {
      elButton.setAttribute("data-ytdl-button-id", SELECT_ALL_BUTTON_ID);
    }

    const hasAny = state.downloadableVideos.length > 0;
    const label = state.isAllSelected ? "Clear selection" : "Select all";
    sendButtonData(elButton, {
      iconName: IconName.None,
      title: label,
      accessibilityText: label,
      style: ButtonStyle.Mono,
      type: ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: hasAny ? ButtonState.Active : ButtonState.Disabled,
      isFullWidth: false,
      isDisabled: !hasAny,
      tooltip: label
    });
  }

  function attachDownloadButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    if (!elButton.hasAttribute("data-ytdl-button-id")) {
      elButton.setAttribute("data-ytdl-button-id", DOWNLOAD_BUTTON_ID);
    }

    const isDisabled = state.selectedDownloadableVideos.length === 0 && !state.isDownloading;
    sendButtonData(elButton, {
      iconName: state.isDownloading ? IconName.Close : IconName.Download,
      title: state.downloadButtonLabel,
      accessibilityText: state.downloadButtonLabel,
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip: state.downloadButtonLabel
    });
  }

  function attachDownloadAllButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    if (!elButton.hasAttribute("data-ytdl-button-id")) {
      elButton.setAttribute("data-ytdl-button-id", DOWNLOAD_ALL_BUTTON_ID);
    }

    const isBusy = state.isRevealingAll || state.isDownloading;
    const downloadAllLabel = state.isRevealingAll
      ? `Loading all videos (${state.revealedVideoCount})`
      : "Download entire playlist";

    sendButtonData(elButton, {
      iconName: state.isRevealingAll ? IconName.Close : IconName.Download,
      title: downloadAllLabel,
      accessibilityText: downloadAllLabel,
      style: ButtonStyle.Mono,
      type: ButtonType.Outline,
      buttonSize: ButtonSize.Default,
      state: isBusy && !state.isRevealingAll ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled: isBusy && !state.isRevealingAll,
      tooltip: downloadAllLabel
    });
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
      if (nextChecked !== state.isScrollSyncEnabled) {
        state.isScrollSyncEnabled = nextChecked;
      }
    }

    elCheckbox.addEventListener("checked-changed", handleCheckedChanged);
  }

  // ─── Click dispatcher ────────────────────────────────────────────────────────

  $effect(() => {
    const clicked = buttonClickSignal.value;
    if (!clicked?.buttonId) {
      return;
    }

    // State reads inside the dispatcher must be untracked — otherwise the
    // effect re-runs when the click mutates state (e.g. isAllSelected flips
    // after selectAll) and re-executes the same branch with inverted logic.
    untrack(() => {
      if (clicked.buttonId === DOWNLOAD_BUTTON_ID) {
        state.toggleSelectedDownload();
        return;
      }

      if (clicked.buttonId === DOWNLOAD_ALL_BUTTON_ID) {
        if (state.isRevealingAll) {
          state.cancelReveal();
        } else {
          void state.revealAndDownloadAll();
        }

        return;
      }

      if (clicked.buttonId === SELECT_ALL_BUTTON_ID) {
        if (state.isAllSelected) {
          state.clearSelection();
        } else {
          state.selectAll();
        }

        return;
      }

      const config = toggleButtons.find(button => button.id === clicked.buttonId);
      config?.onClick();
    });
  });

  const isDataSaverSelected = $derived(state.downloadMode === PlaylistDownloadMode.DataSaver);
</script>

<div class="ytdl-playlist-container" aria-label="Playlist Downloader" role="region">
  {#if state.error}
    <div class="ytdl-error-banner" role="alert">{state.error}</div>
  {/if}

  <div class="ytdl-toggle-group" aria-label="Download speed" role="group">
    <yt-button-view-model {@attach createToggleAttacher(toggleButtons[0])}></yt-button-view-model>
    <yt-button-view-model {@attach createToggleAttacher(toggleButtons[1])}></yt-button-view-model>
  </div>

  <div class="ytdl-toggle-group" aria-label="Output format" role="group">
    <yt-button-view-model {@attach createToggleAttacher(toggleButtons[2])}></yt-button-view-model>
    <yt-button-view-model {@attach createToggleAttacher(toggleButtons[3])}></yt-button-view-model>
  </div>

  <div class="ytdl-playlist-actions">
    <div class="ytdl-selection-row">
      <yt-button-view-model {@attach attachSelectAllButton}></yt-button-view-model>
      <span class="ytdl-selection-count" aria-live="polite">
        {state.selectedDownloadableVideos.length} / {state.downloadableVideos.length} selected
      </span>
    </div>
    <yt-button-view-model {@attach attachDownloadButton}></yt-button-view-model>
    <yt-button-view-model {@attach attachDownloadAllButton}></yt-button-view-model>

    {#if state.isDownloading && state.totalCount > 0}
      <tp-yt-paper-progress
        {@attach attachProgressBar}
        max={state.totalCount}
        value={state.downloadedCount}
      ></tp-yt-paper-progress>
    {/if}
  </div>

  {#if isDataSaverSelected}
    <div class="ytdl-scroll-sync-option">
      <tp-yt-paper-checkbox
        {@attach attachScrollSyncCheckbox}
        checked={state.isScrollSyncEnabled || undefined}
      >
        Scroll to currently-downloading video
      </tp-yt-paper-checkbox>
    </div>
  {/if}

  {#if state.nonDownloadableCount > 0}
    <p class="ytdl-restriction-notice" role="status">
      {state.nonDownloadableCount} video{state.nonDownloadableCount === 1 ? "" : "s"} not downloadable
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

  .ytdl-toggle-group {
    display: flex;
    gap: 4px;
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
    color: var(--yt-spec-text-secondary, #aaa);
    font-size: 1.2rem;
  }

  .ytdl-error-banner {
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--yt-spec-error-indicator, rgb(204 0 0));
    color: #ffffff;
    font-size: 1.3rem;
  }

  .ytdl-restriction-notice {
    margin: 0;
    font-size: 1.2rem;
  }

  .ytdl-scroll-sync-option {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 1.2rem;
    cursor: pointer;
  }
</style>
