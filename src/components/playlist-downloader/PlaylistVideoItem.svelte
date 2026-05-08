<script lang="ts" module>
  const activeDownloadClicks = $state(new Set<string>());
</script>

<script lang="ts">
  import { batchCanceledIds, batchDownloadStatus, batchVideoIds } from "./PlaylistDownloader.state.svelte";
  import { createPanelManager } from "./PlaylistVideoItem.panel.svelte";
  import { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
  import { DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    IconName
  } from "@/types";
  import { untrack } from "svelte";

  type Props = {
    videoId: string;
    gridTitle?: string;
    isPlaylistItem?: boolean;
  };

  const { videoId, gridTitle, isPlaylistItem = false }: Props = $props();

  const isChecked = $derived(checkedPlaylistVideos.has(videoId));
  const isInBatch = $derived(batchVideoIds.has(videoId));
  const isIndividuallyCanceled = $derived(batchCanceledIds.has(videoId));

  const itemState = createPlaylistVideoItemState({
    videoId: untrack(() => videoId),
    gridTitle: untrack(() => gridTitle),
    activeDownloadClicks
  });

  // Indeterminate: video is in the active batch and still actively downloading/processing.
  const isCheckboxIndeterminate = $derived(
    batchDownloadStatus.isRunning && isInBatch && !isIndividuallyCanceled && itemState.isDownloading
  );

  // Disabled while any batch is running, or individually downloading for the first
  // time (isLocallyDone=false). isLocallyDone is sticky: once the download phase completes it stays
  // true, so FFmpeg's transient isDownloading=true (after a premature batch completion caused by the
  // download-phase progress=1) won't re-disable the checkbox.
  const isCheckboxDisabled = $derived(
    batchDownloadStatus.isRunning || (itemState.isDownloading && !itemState.isLocallyDone)
  );

  const isZipBatchActive = $derived(
    batchDownloadStatus.isRunning && batchDownloadStatus.isZipBatch && isInBatch && !isIndividuallyCanceled
  );

  const isInProgressInZipBatch = $derived(isZipBatchActive && !itemState.isDownloading);

  const isProgressBarVisible = $derived(
    isPlaylistItem && (itemState.isDownloading || itemState.isDone || itemState.isLocallyDone || isInProgressInZipBatch)
  );

  const isProgressBarIndeterminate = $derived(
    !itemState.isDone && !itemState.isLocallyDone && !isInProgressInZipBatch && itemState.displayProgress === 0
  );

  const progressBarValue = $derived(
    itemState.isDone || itemState.isLocallyDone || isInProgressInZipBatch
      ? 100
      : Math.round(itemState.displayProgress)
  );

  const CIRCULAR_PROGRESS_RADIUS = 17;
  const CIRCULAR_PROGRESS_CIRCUMFERENCE = 2 * Math.PI * CIRCULAR_PROGRESS_RADIUS;

  const downloadButtonId = $derived(`btn-${videoId}-download`);
  const chevronButtonId = $derived(`btn-${videoId}-chevron`);

  let elCheckbox = $state<HTMLElement | null>(null);
  let elButtonGroup: HTMLElement | null = null;
  let elDownloadBtn: Element | null = null;
  let elChevronBtn: Element | null = null;

  let buttonRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const buttonRefreshIntervalMs = 250;

  function attachCheckbox(elTarget: Element) {
    if (elTarget instanceof HTMLElement) {
      elCheckbox = elTarget;
    }
  }

  $effect(() => {
    if (!elCheckbox) {
      return;
    }

    if (isCheckboxIndeterminate) {
      elCheckbox.setAttribute("indeterminate", "");
      elCheckbox.setAttribute("aria-checked", "mixed");
      return;
    }

    elCheckbox.removeAttribute("indeterminate");
    elCheckbox.setAttribute("aria-checked", isChecked ? "true" : "false");
  });

  function assignButtonId({ elButton, id }: {
    elButton: Element;
    id: string;
  }) {
    if (elButton.getAttribute(DATA_BUTTON_ID_ATTR) !== id) {
      elButton.setAttribute(DATA_BUTTON_ID_ATTR, id);
    }
  }

  function refreshDownloadButton() {
    if (!elDownloadBtn) {
      return;
    }

    const tooltip = itemState.buttonTooltip;
    const isDownloadDisabled = !itemState.videoData?.isDownloadable || isInProgressInZipBatch;
    const downloadIconName = isInProgressInZipBatch ? IconName.CheckCircleThick : itemState.downloadIconName;
    assignButtonId({
      elButton: elDownloadBtn,
      id: downloadButtonId
    });
    sendButtonData({
      elButton: elDownloadBtn,
      data: {
        iconName: downloadIconName,
        title: "",
        accessibilityText: itemState.videoData ? `${tooltip} ${itemState.videoData.title}` : tooltip,
        style: ButtonStyle.Mono,
        type: ButtonType.Tonal,
        buttonSize: ButtonSize.Default,
        state: isDownloadDisabled ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: isDownloadDisabled,
        tooltip
      }
    });
  }

  // iron-dropdown's shadow/margin can make its bottom edge sit a couple pixels
  // past the anchor's top, so a strict "bottom <= top" misses the above case.
  const panelAboveOverlapPx = 4;

  function isPanelAboveChevron() {
    if (!panel.isOpen || !panel.elDropdown || !elChevronBtn) {
      return false;
    }

    const chevronRect = elChevronBtn.getBoundingClientRect();
    const dropdownRect = panel.elDropdown.getBoundingClientRect();
    return dropdownRect.bottom <= chevronRect.top + panelAboveOverlapPx;
  }

  function refreshChevronButton() {
    if (!elChevronBtn) {
      return;
    }

    const isChevronDisabled = !itemState.videoData?.isDownloadable;
    assignButtonId({
      elButton: elChevronBtn,
      id: chevronButtonId
    });
    // Chevron points at the panel: up when the panel sits above, down when
    // it sits below (including the closed state, which hints at where the
    // panel will appear by default).
    sendButtonData({
      elButton: elChevronBtn,
      data: {
        iconName: isPanelAboveChevron() ? IconName.ExpandLess : IconName.ExpandMore,
        title: "",
        accessibilityText: "Download options",
        style: ButtonStyle.Mono,
        type: ButtonType.Tonal,
        buttonSize: ButtonSize.Default,
        state: isChevronDisabled ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: isChevronDisabled,
        tooltip: "Options"
      }
    });
  }

  $effect(() => {
    void itemState.downloadState;
    void itemState.isDownloadFailed;
    void isZipBatchActive;

    if (buttonRefreshTimer) {
      return;
    }

    queueMicrotask(() => {
      refreshDownloadButton();
      refreshChevronButton();
    });

    buttonRefreshTimer = setTimeout(() => {
      buttonRefreshTimer = null;
    }, buttonRefreshIntervalMs);
  });

  const panel = createPanelManager(
    untrack(() => videoId),
    () => itemState.videoData,
    () => elButtonGroup,
    refreshChevronButton
  );

  function togglePanel() {
    panel.toggle();
    refreshChevronButton();
  }

  function attachButtonGroup(elTarget: Element) {
    if (elTarget instanceof HTMLElement) {
      elButtonGroup = elTarget;
    }
  }

  function attachDownloadButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elDownloadBtn = elButton;

    // Direct listener as fallback: Polymer may strip data-ytdl-button-id from non-first
    // buttons before the MAIN world's SetButtonData handler can run querySelector,
    // leaving those buttons without a click binding. This ISOLATED-world listener
    // fires regardless and is guarded by activeDownloadClicks in handleDownloadClick.
    function onDownloadClick() {
      if (!isInProgressInZipBatch) {
        queueMicrotask(() => void itemState.handleDownloadClick());
      }
    }
    elButton.addEventListener("click", onDownloadClick);
    refreshDownloadButton();
    return () => elButton.removeEventListener("click", onDownloadClick);
  }

  function attachChevronButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elChevronBtn = elButton;

    function onChevronClick() {
      queueMicrotask(togglePanel);
    }
    elButton.addEventListener("click", onChevronClick);
    refreshChevronButton();
    elButton.setAttribute("style", "margin-left: 0 !important");
    return () => elButton.removeEventListener("click", onChevronClick);
  }

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === downloadButtonId && !isInProgressInZipBatch) {
      queueMicrotask(() => {
        void itemState.handleDownloadClick();
      });
    } else if (buttonId === chevronButtonId) {
      queueMicrotask(() => togglePanel());
    }
  }));
</script>

<div class="ytdl-button-group" {@attach attachButtonGroup}>
  {#if itemState.videoData?.isDownloadable}
    <div class="ytdl-button-row" class:ytdl-button-row--has-checkbox={isPlaylistItem}>
      {#if isPlaylistItem}
        <tp-yt-paper-checkbox
          {@attach attachCheckbox}
          aria-label="Select for download"
          checked={(isCheckboxIndeterminate || isChecked) ? "" : undefined}
          disabled={isCheckboxDisabled ? "" : undefined}
          onchange={e => {
            if (!(e.target instanceof HTMLElement) || isCheckboxDisabled) {
              return;
            }

            // Reading hasAttribute("checked") (not toggling) keeps programmatic writes idempotent
            // when selectAll/clearSelection flips isChecked.
            const isNowChecked = e.target.hasAttribute("checked");
            if (isNowChecked && !checkedPlaylistVideos.has(videoId)) {
              checkedPlaylistVideos.add(videoId);
            } else if (!isNowChecked && checkedPlaylistVideos.has(videoId)) {
              checkedPlaylistVideos.delete(videoId);
            }
          }}
        ></tp-yt-paper-checkbox>
      {/if}
      <div class="ytdl-download-btn-wrapper">
        <yt-button-view-model {@attach attachDownloadButton}
        ></yt-button-view-model>
        {#if isProgressBarVisible}
          <svg
            class="ytdl-circular-progress"
            aria-label={itemState.buttonTooltip}
            viewBox="0 0 40 40"
          >
            <circle class="ytdl-circular-progress__track" cx="20" cy="20" r={CIRCULAR_PROGRESS_RADIUS} />
            <circle
              style={isProgressBarIndeterminate
                ? undefined
                : `stroke-dashoffset: ${CIRCULAR_PROGRESS_CIRCUMFERENCE * (1 - progressBarValue / 100)}`}
              class="ytdl-circular-progress__fill"
              class:ytdl-circular-progress__fill--indeterminate={isProgressBarIndeterminate}
              cx="20"
              cy="20"
              r={CIRCULAR_PROGRESS_RADIUS}
            />
          </svg>
        {/if}
      </div>
      <yt-button-view-model {@attach attachChevronButton}
      ></yt-button-view-model>
    </div>
  {:else if !itemState.videoData && !itemState.isLoadFailed}
    <div class="ytdl-spinner-container" aria-busy="true" aria-label="Loading video info">
      <tp-yt-paper-spinner-lite active></tp-yt-paper-spinner-lite>
    </div>
  {/if}
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

  .ytdl-button-row--has-checkbox {
    padding:
      calc(
        (var(--paper-checkbox-ink-size, 48px) - var(--paper-checkbox-size, 18px)) / 2
      );
  }

  .ytdl-download-btn-wrapper {
    position: relative;
    display: inline-flex;
  }

  .ytdl-circular-progress {
    position: absolute;
    inset: 0;
    overflow: visible;
    width: 100%;
    height: 100%;
    pointer-events: none;
    transform: rotate(-90deg);
  }

  .ytdl-circular-progress__track {
    fill: none;
    stroke: var(--yt-spec-10-percent-overlay, rgb(0 0 0 / 10%));
    stroke-width: 2.5;
  }

  .ytdl-circular-progress__fill {
    fill: none;
    stroke: var(--yt-spec-brand-button-background, #ff0000);
    stroke-dasharray: 106.81;
    stroke-linecap: round;
    stroke-width: 2.5;
    transition: stroke-dashoffset 300ms ease;
  }

  .ytdl-circular-progress__fill--indeterminate {
    stroke-dasharray: 40 66.81;
    animation: ytdl-circular-spin 1000ms linear infinite;
  }

  @keyframes ytdl-circular-spin {
    to {
      stroke-dashoffset: -106.81;
    }
  }

  .ytdl-spinner-container {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 8px;
  }

  /*
   * YouTube strips the indeterminate state from tp-yt-paper-checkbox.
   * These rules restore it using the [indeterminate] attribute and the
   * component's own CSS variables, so the dash adapts to YouTube's theme.
   * Specificity (2,3,1) beats the checkmark animation rule (2,3,0).
   */
  :global(tp-yt-paper-checkbox[indeterminate] #checkbox.tp-yt-paper-checkbox) {
    border-color: var(--paper-checkbox-checked-color, var(--primary-color));
    background-color: var(--paper-checkbox-checked-color, var(--primary-color));

    :global(#checkmark.tp-yt-paper-checkbox) {
      top: 50%;
      left: 25%;
      width: 50%;
      height: 0;
      border-right-width: 0;
      translate: 0 -50%;
      animation-name: none;
    }
  }
</style>
