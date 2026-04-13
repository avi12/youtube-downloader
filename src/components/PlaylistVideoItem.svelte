<script lang="ts" module>
  // Module-level guard to prevent duplicate download triggers from
  // multiple component instances responding to the same ButtonClick message
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

  // Sync the selection set from the Polymer checkbox's reported state. Using
  // `e.target.checked` (not a toggle) keeps programmatic writes idempotent:
  // when selectAll/clearSelection flips `isChecked`, Polymer re-fires the
  // `change` event, but this handler no-ops because the set already matches.
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
  // videoId + gridTitle are stable for the component's lifetime (grid keys by videoId).
  // untrack() acknowledges this so Svelte doesn't warn about capturing initial values.
  const itemState = createPlaylistVideoItemState(
    untrack(() => videoId),
    untrack(() => gridTitle),
    () => options,
    activeDownloadClicks
  );

  const downloadButtonId = $derived(`btn-${videoId}-download`);
  const chevronButtonId = $derived(`btn-${videoId}-chevron`);

  // ─── Button refresh (throttled) ──────────────────────────────────────────────

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

  function refreshChevronButton() {
    if (!elChevronBtn) {
      return;
    }

    assignButtonId(elChevronBtn, chevronButtonId);
    sendButtonData(elChevronBtn, {
      iconName: isPanelOpen ? IconName.ExpandLess : IconName.ExpandMore,
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

  // ─── Dropdown panel ──────────────────────────────────────────────────────────

  let isPanelOpen = $state(false);
  let elDropdown: HTMLElement | null = null;
  let panelInstance: ReturnType<typeof mount> | null = null;
  let unsubscribeDropdownReady: (() => void) | null = null;

  function openPanel() {
    if (!itemState.videoData || !elButtonGroup || elDropdown) {
      return;
    }

    const currentVideoData = itemState.videoData;
    // Create dropdown via MAIN world bridge - Polymer elements need the
    // MAIN world's Polymer runtime to function (open/close, positioning).
    const panelContentId = `ytdl-grid-panel-${videoId}`;

    void crossWorldMessenger.sendMessage(CrossWorldMessage.CreateDropdown, {
      contentId: panelContentId,
      positionTargetSelector: `[data-ytdl-grid-item="${videoId}"] .ytdl-button-group`
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

  // ─── Button attach + click dispatch ──────────────────────────────────────────

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
