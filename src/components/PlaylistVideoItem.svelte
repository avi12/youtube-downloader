<script lang="ts" module>
  // Guards against duplicate downloads from multiple component instances
  // responding to the same ButtonClick.
  const activeDownloadClicks = $state(new Set<string>());
</script>

<script lang="ts">
  import DownloadOptionsPanel from "./DownloadOptionsPanel.svelte";
  import { createPlaylistVideoItemState } from "./PlaylistVideoItem.state.svelte";
  import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
  import { checkedPlaylistVideos } from "@/lib/playlist-selection.svelte";
  import { sendButtonData } from "@/lib/polymer-utils";
  import { buttonClickSignal } from "@/lib/synced-stores.svelte";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    IconName,
    type Options
  } from "@/types";
  import { mount, unmount, untrack } from "svelte";

  type Props = {
    videoId: string;
    gridTitle?: string;
    isPlaylistItem?: boolean;
    options: Options;
  };

  const { videoId, gridTitle, isPlaylistItem = false, options }: Props = $props();

  const isChecked = $derived(checkedPlaylistVideos.has(videoId));

  // Reading `e.target.checked` (not toggling) keeps programmatic writes idempotent
  // when selectAll/clearSelection flips isChecked.
  function handleCheckboxChange(e: Event) {
    if (!(e.target instanceof HTMLElement)) {
      return;
    }

    const isNowChecked = e.target.hasAttribute("checked");
    if (isNowChecked && !checkedPlaylistVideos.has(videoId)) {
      checkedPlaylistVideos.add(videoId);
    } else if (!isNowChecked && checkedPlaylistVideos.has(videoId)) {
      checkedPlaylistVideos.delete(videoId);
    }
  }
  const itemState = createPlaylistVideoItemState(
    untrack(() => videoId),
    untrack(() => gridTitle),
    () => options,
    activeDownloadClicks
  );

  const downloadButtonId = $derived(`btn-${videoId}-download`);
  const chevronButtonId = $derived(`btn-${videoId}-chevron`);

  let elButtonGroup: HTMLElement | null = null;
  let elDownloadBtn: Element | null = null;
  let elChevronBtn: Element | null = null;

  let buttonRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const buttonRefreshIntervalMs = 250;

  function assignButtonId(elButton: Element, id: string) {
    if (elButton.getAttribute("data-ytdl-button-id") !== id) {
      elButton.setAttribute("data-ytdl-button-id", id);
    }
  }

  function refreshDownloadButton() {
    if (!elDownloadBtn) {
      return;
    }

    const tooltip = itemState.buttonTooltip;
    assignButtonId(elDownloadBtn, downloadButtonId);
    sendButtonData(elDownloadBtn, {
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
    });
  }

  function isPanelAboveChevron() {
    if (!isPanelOpen || !elDropdown || !elChevronBtn) {
      return false;
    }

    const chevronRect = elChevronBtn.getBoundingClientRect();
    const dropdownRect = elDropdown.getBoundingClientRect();
    return dropdownRect.bottom <= chevronRect.top + 4;
  }

  function refreshChevronButton() {
    if (!elChevronBtn) {
      return;
    }

    assignButtonId(elChevronBtn, chevronButtonId);
    // Chevron points at the panel: up when the panel sits above, down when
    // it sits below (including the closed state, which hints at where the
    // panel will appear by default).
    sendButtonData(elChevronBtn, {
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

  let isPanelOpen = $state(false);
  let elDropdown: HTMLElement | null = null;
  let panelInstance: ReturnType<typeof mount> | null = null;
  let unsubscribeDropdownReady: (() => void) | null = null;

  function openPanel() {
    if (!itemState.videoData || !elButtonGroup || elDropdown) {
      return;
    }

    const currentVideoData = itemState.videoData;
    // Polymer elements need the MAIN world's Polymer runtime to function,
    // so create the dropdown via the MAIN world bridge.
    const panelContentId = `ytdl-grid-panel-${videoId}`;
    // Grid cards mark themselves with data-ytdl-grid-item, playlist rows with
    // data-ytdl-item. Match either so iron-dropdown can anchor on both pages.
    const positionTargetSelector
      = `[data-ytdl-grid-item="${videoId}"] .ytdl-button-group, [data-ytdl-item="${videoId}"] .ytdl-button-group`;

    void crossWorldMessenger.sendMessage(CrossWorldMessage.CreateDropdown, {
      contentId: panelContentId,
      positionTargetSelector
    });

    unsubscribeDropdownReady = crossWorldMessenger.onMessage(CrossWorldMessage.DropdownReady, ({ data }) => {
      if (data.contentId !== panelContentId) {
        return;
      }

      unsubscribeDropdownReady?.();
      unsubscribeDropdownReady = null;

      if (panelInstance) {
        return;
      }

      const elContent = document.getElementById(panelContentId);
      if (!elContent) {
        return;
      }

      elDropdown = elContent.closest("tp-yt-iron-dropdown");

      panelInstance = mount(DownloadOptionsPanel, {
        target: elContent,
        props: { videoData: currentVideoData, options }
      });

      // iron-dropdown only finishes positioning on iron-overlay-opened — that's
      // when the anchor-relative above/below decision is final, so refresh the
      // chevron direction from there.
      elDropdown?.addEventListener("iron-overlay-opened", () => refreshChevronButton(), { once: true });

      function handleOverlayClose() {
        if (isPanelOpen) {
          isPanelOpen = false;
          closePanel();
        }

        elDropdown?.removeEventListener("iron-overlay-closed", handleOverlayClose);
        document.removeEventListener("ytdl:panel-closed", handleOverlayClose);
      }

      elDropdown?.addEventListener("iron-overlay-closed", handleOverlayClose);
      document.addEventListener("ytdl:panel-closed", handleOverlayClose);
    });
  }

  function closePanel() {
    if (unsubscribeDropdownReady) {
      unsubscribeDropdownReady();
      unsubscribeDropdownReady = null;
    }

    if (panelInstance) {
      void unmount(panelInstance);
      panelInstance = null;
    }

    if (elDropdown) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.CloseDropdown, { videoId });
      elDropdown = null;
    }
  }

  function togglePanel() {
    isPanelOpen = !isPanelOpen;
    refreshChevronButton();

    if (isPanelOpen) {
      openPanel();
    } else {
      closePanel();
    }
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

  $effect(() => {
    const clicked = buttonClickSignal.value;
    if (!clicked?.buttonId) {
      return;
    }

    if (clicked.buttonId === downloadButtonId) {
      queueMicrotask(() => {
        void itemState.handleDownloadClick();
      });
      return;
    }

    if (clicked.buttonId === chevronButtonId) {
      queueMicrotask(() => togglePanel());
    }
  });
</script>

<div class="ytdl-button-group" {@attach attachButtonGroup}>
  {#if itemState.videoData?.isDownloadable}
    <div class="ytdl-button-row">
      {#if isPlaylistItem}
        <tp-yt-paper-checkbox
          aria-label="Select for download"
          checked={isChecked || undefined}
          onchange={handleCheckboxChange}
        ></tp-yt-paper-checkbox>
      {/if}
      <yt-button-view-model {@attach attachDownloadButton}
      ></yt-button-view-model>
      <yt-button-view-model {@attach attachChevronButton}
      ></yt-button-view-model>
      {#if itemState.isDownloading || itemState.isDone}
        <tp-yt-paper-progress
          class="ytdl-progress-bar"
          aria-label={itemState.buttonTooltip}
          value={itemState.isDone ? 100 : Math.round(itemState.displayProgress)}
        ></tp-yt-paper-progress>
      {/if}
    </div>
  {:else if !itemState.videoData && !itemState.isLoadFailed}
    <div class="ytdl-spinner-container" aria-busy="true" aria-label="Loading video info">
      <tp-yt-paper-spinner-lite active></tp-yt-paper-spinner-lite>
    </div>
  {/if}
</div>

<style>
  :global(ytd-menu-renderer.ytd-playlist-video-renderer:has([data-ytdl-item])) {
    display: flex;
    flex-direction: row;
    align-items: center;
  }

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
    overflow: hidden;
  }

  .ytdl-progress-bar {
    position: absolute;
    inset-block-end: 0;
    inset-inline-start: 0;
    block-size: 3px;
    inline-size: 100%;
  }

  .ytdl-spinner-container {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 8px;
  }
</style>
