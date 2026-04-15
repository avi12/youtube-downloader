<script lang="ts" module>
  const activeDownloadClicks = $state(new Set<string>());
</script>

<script lang="ts">
  import { batchDownloadStatus } from "./PlaylistDownloader.state.svelte";
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

  const itemState = createPlaylistVideoItemState({
    videoId: untrack(() => videoId),
    gridTitle: untrack(() => gridTitle),
    activeDownloadClicks
  });

  const isCheckboxDisabled = $derived(batchDownloadStatus.isRunning || itemState.isDownloading);

  const downloadButtonId = $derived(`btn-${videoId}-download`);
  const chevronButtonId = $derived(`btn-${videoId}-chevron`);

  let elButtonGroup: HTMLElement | null = null;
  let elDownloadBtn: Element | null = null;
  let elChevronBtn: Element | null = null;

  let buttonRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const buttonRefreshIntervalMs = 250;

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
    assignButtonId({ elButton: elDownloadBtn, id: downloadButtonId });
    sendButtonData({
      elButton: elDownloadBtn,
      data: {
        iconName: itemState.downloadIconName,
        title: "",
        accessibilityText: itemState.videoData ? `${tooltip} ${itemState.videoData.title}` : tooltip,
        style: ButtonStyle.Mono,
        type: ButtonType.Tonal,
        buttonSize: ButtonSize.Default,
        state: !itemState.videoData?.isDownloadable ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: !itemState.videoData?.isDownloadable,
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

    assignButtonId({ elButton: elChevronBtn, id: chevronButtonId });
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
        state: !itemState.videoData?.isDownloadable ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled: !itemState.videoData?.isDownloadable,
        tooltip: "Options"
      }
    });
  }

  $effect(() => {
    void itemState.downloadState;

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
    if (buttonId === downloadButtonId) {
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
          aria-label="Select for download"
          checked={isChecked ? "" : undefined}
          disabled={isCheckboxDisabled ? "" : undefined}
          onchange={e => {
            if (!(e.target instanceof HTMLElement)) {
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
      {#if itemState.isDownloading || itemState.isDone || itemState.isLocallyDone}
        <div class="ytdl-progress-container">
          <tp-yt-paper-progress
            class="ytdl-progress-bar"
            aria-label={itemState.buttonTooltip}
            indeterminate={(!itemState.isDone && !itemState.isLocallyDone && itemState.displayProgress === 0)
              || undefined}
            value={itemState.isDone || itemState.isLocallyDone ? 100 : Math.round(itemState.displayProgress)}
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
</style>
