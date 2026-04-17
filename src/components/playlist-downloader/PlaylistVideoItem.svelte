<script lang="ts" module>
  const activeDownloadClicks = $state(new Set<string>());
</script>

<script lang="ts">
  import { batchCanceledIds, batchDownloadStatus, batchVideoIds } from "./PlaylistDownloader.state.svelte";
  import { createPanelManager } from "./PlaylistVideoItem.panel.svelte";
  import { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
  import { sendButtonData } from "@/lib/ui/polymer-utils";
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
    itemState.isDownloading || itemState.isDone || itemState.isLocallyDone || isInProgressInZipBatch
  );

  const isProgressBarIndeterminate = $derived(
    !itemState.isDone && !itemState.isLocallyDone && !isInProgressInZipBatch && itemState.displayProgress === 0
  );

  const progressBarValue = $derived(
    itemState.isDone || itemState.isLocallyDone || isInProgressInZipBatch
      ? 100
      : Math.round(itemState.displayProgress)
  );

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
    if (elButton.getAttribute("data-ytdl-button-id") !== id) {
      elButton.setAttribute("data-ytdl-button-id", id);
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
    refreshDownloadButton();
  }

  function attachChevronButton(elButton: Element) {
    if (!(elButton instanceof HTMLElement)) {
      return;
    }

    elChevronBtn = elButton;
    refreshChevronButton();
    elButton.setAttribute("style", "margin-left: 0 !important");
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
    <div class="ytdl-button-row">
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
      <yt-button-view-model {@attach attachDownloadButton}
      ></yt-button-view-model>
      <yt-button-view-model {@attach attachChevronButton}
      ></yt-button-view-model>
      {#if isProgressBarVisible}
        <div class="ytdl-progress-container">
          <tp-yt-paper-progress
            class="ytdl-progress-bar"
            aria-label={itemState.buttonTooltip}
            indeterminate={isProgressBarIndeterminate || undefined}
            value={progressBarValue}
          ></tp-yt-paper-progress>
        </div>
      {/if}
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
  }

  .ytdl-button-row {
    position: relative;
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;
    padding:
      calc(
        (var(--paper-checkbox-ink-size, 48px) - var(--paper-checkbox-size, 18px)) / 2
      );
  }

  .ytdl-progress-container {
    position: absolute;
    inset-block-end: 0;
    inset-inline-start: 0;
    overflow: hidden;
    block-size: 3px;
    inline-size: 100%;
  }

  .ytdl-progress-bar {
    block-size: 100%;
    inline-size: 100%;
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
