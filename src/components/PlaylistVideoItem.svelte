<script lang="ts" module>
  // Module-level guard to prevent duplicate download triggers from
  // multiple component instances responding to the same ButtonClick message
  const activeDownloadClicks = $state(new Set<string>());
</script>

<script lang="ts">
  import { MessageType, sendMessage } from "../lib/messaging";
  import {
    buttonClickSignal,
    cancelRequestSignal,
    downloadProgressStore,
    type DownloadProgressState,
    SYNC_NAMESPACE,
    SyncKey,
    videoDataRequests,
    videoDataStore
  } from "../lib/synced-stores.svelte";
  import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "../lib/utils";
  import { ProgressType } from "../types";
  import type { DownloadType } from "../types";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    IconName,
    type Options,
    type VideoData
  } from "../types";
  import DownloadOptionsPanel from "./DownloadOptionsPanel.svelte";
  import { mount, unmount } from "svelte";

  type Props = {
    videoId: string;
    options: Options;
  };

  const { videoId, options }: Props = $props();

  let videoData = $state<VideoData | null>(null);
  const defaultProgressState: DownloadProgressState = {
    isDownloading: false,
    isDone: false,
    isQueued: false,
    progress: 0,
    progressType: ""
  };

  const downloadState = $derived(downloadProgressStore.get(videoId) ?? defaultProgressState);
  const isDownloading = $derived(downloadState.isDownloading);
  const isDone = $derived(downloadState.isDone);
  let isLoadFailed = $state(false);

  // Reactively read video data from the synced store.
  // The MAIN world writes to videoDataStore, which syncs via postMessage.
  $effect(() => {
    const storeData = videoDataStore.get(videoId);
    if (storeData) {
      videoData = storeData;
      return;
    }

    // Request from MAIN world via synced signal (crosses world boundary)
    videoDataRequests.set(videoId, true);

    const loadTimeout = setTimeout(() => {
      if (!videoData) {
        isLoadFailed = true;
      }
    }, 15_000);

    return () => clearTimeout(loadTimeout);
  });

  // Reactively refresh buttons when shared download state changes.
  // Reading downloadState registers it as a reactive dependency.
  $effect(() => {
    void downloadState;
    refreshDownloadButton();
    refreshChevronButton();
  });

  const buttonLabel = $derived(() => {
    if (!videoData?.isDownloadable) {
      return "N/A";
    }

    if (isDone) {
      return "Downloaded";
    }

    if (isDownloading) {
      return "Cancel";
    }

    return "Download";
  });

  async function handleDownloadClick() {
    if (!videoData?.isDownloadable || activeDownloadClicks.has(videoId)) {
      return;
    }

    if (isDownloading) {
      downloadProgressStore.delete(videoId);
      cancelRequestSignal.value = { videoIds: [videoId] };
      return;
    }

    let downloadType: DownloadType = videoData.isMusic ? "audio" : "video+audio";
    if (options.defaultDownloadType && options.defaultDownloadType !== "auto") {
      downloadType = options.defaultDownloadType;
    }

    const selectedVideoFormat = videoData.videoFormats[0] ?? null;
    const selectedAudioFormat = videoData.audioFormats[0] ?? null;
    const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
    const defaultFormat = videoData.isMusic ? selectedAudioFormat : selectedVideoFormat;
    const resolvedExtension = resolveAutoExtension(extPref, defaultFormat?.mimeType ?? "", videoData.isMusic ? "audio" : "video");
    const outputExtension = selectedVideoFormat && selectedAudioFormat && !videoData.isMusic
      ? getOutputExtension(selectedVideoFormat.mimeType, selectedAudioFormat.mimeType, resolvedExtension)
      : resolvedExtension;
    const filenameOutput = getCompatibleFilename(`${videoData.title}.${outputExtension}`);
    if (!videoData.sabrConfig) {
      return;
    }

    activeDownloadClicks.add(videoId);
    downloadProgressStore.set(videoId, {
      isDownloading: true,
      isDone: false,
      isQueued: false,
      progress: 0,
      progressType: ""
    });

    try {
      // Chrome strips Origin from extension SW fetch, causing googlevideo 403.
      // Open a background watch tab where YouTube's SW handles CORS natively.
      // The tab is created inactive so the user stays on subscriptions.
      await sendMessage(MessageType.DownloadViaWatchPage, {
        type: downloadType,
        videoId,
        videoItag: selectedVideoFormat?.itag ?? 0,
        audioItag: selectedAudioFormat?.itag ?? 0,
        filenameOutput
      });
    } finally {
      activeDownloadClicks.delete(videoId);
    }
  }

  function getItemIconName() {
    if (isDone) {
      return IconName.CheckCircleThick;
    }

    if (isDownloading) {
      return IconName.Close;
    }

    return IconName.Download;
  }

  let isPanelOpen = $state(false);
  let elDropdown: HTMLElement | null = null;
  let panelInstance: ReturnType<typeof mount> | null = null;
  let elButtonGroup: HTMLElement | null = null;
  let elDownloadBtn: Element | null = null;
  let elChevronBtn: Element | null = null;
  let pendingDropdownListener: ((e: MessageEvent) => void) | null = null;

  // Weighted progress: download phase = 0-80%, mux phase = 80-100%
  // Both phases report their own 0-1 progress, combined into a single 0-100 value
  const displayProgress = $derived.by(() => {
    if (!isDownloading) {
      return 0;
    }

    const isMuxPhase = downloadState.progressType === ProgressType.FFmpeg;
    if (isMuxPhase) {
      return 80 + downloadState.progress * 20;
    }

    return downloadState.progress * 80;
  });

  function getDefaultQualityLabel() {
    if (!videoData) {
      return "";
    }

    const videoFormat = videoData.videoFormats[0];
    if (!videoFormat) {
      return "";
    }

    return `${videoFormat.height}p${videoFormat.fps ? ` ${videoFormat.fps}fps` : ""}`;
  }

  function getButtonTooltip() {
    if (isDownloading) {
      if (downloadState.progress <= 0) {
        return buttonLabel();
      }

      const phase = downloadState.progressType === ProgressType.FFmpeg ? "Processing" : "Downloading";
      return `${Math.round(displayProgress)}% - ${phase}`;
    }

    if (!videoData?.isDownloadable) {
      return buttonLabel();
    }

    const quality = getDefaultQualityLabel();
    const videoFormat = videoData.videoFormats[0];
    const audioFormat = videoData.audioFormats[0];
    const resolvedExt = resolveAutoExtension(options.ext.video, videoFormat?.mimeType ?? "", "video");
    const extension = videoFormat && audioFormat
      ? getOutputExtension(videoFormat.mimeType, audioFormat.mimeType, resolvedExt)
      : resolvedExt;
    if (!quality) {
      return `${videoData.title}.${extension}`;
    }

    return `${videoData.title}.${extension} - ${quality}`;
  }

  function refreshDownloadButton() {
    if (!elDownloadBtn) {
      return;
    }

    const tooltip = getButtonTooltip();

    setButtonData(elDownloadBtn, {
      iconName: getItemIconName(),
      title: "",
      accessibilityText: videoData ? `${tooltip} ${videoData.title}` : tooltip,
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: !videoData?.isDownloadable ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled: !videoData?.isDownloadable,
      tooltip
    });
  }

  let buttonIdCounter = 0;

  function setButtonData(element: Element, data: Record<string, unknown>) {
    if (!element.hasAttribute("data-ytdl-button-id")) {
      element.setAttribute("data-ytdl-button-id", `btn-${videoId}-${buttonIdCounter++}`);
    }

    postMessage({
      namespace: SYNC_NAMESPACE,
      key: SyncKey.SetButtonData,
      value: {
        selector: `[data-ytdl-button-id="${element.getAttribute("data-ytdl-button-id")}"]`,
        data
      }
    }, location.origin);
  }

  function openPanel() {
    if (!videoData || !elButtonGroup) {
      return;
    }

    const currentVideoData = videoData;
    if (elDropdown) {
      return;
    }

    // Create dropdown via MAIN world bridge - Polymer elements need the
    // MAIN world's Polymer runtime to function (open/close, positioning).
    const panelContentId = `ytdl-grid-panel-${videoId}`;

    postMessage({
      namespace: SYNC_NAMESPACE,
      key: SyncKey.CreateDropdown,
      value: {
        contentId: panelContentId,
        positionTargetSelector: `[data-ytdl-grid-item="${videoId}"] .ytdl-button-group`
      }
    }, location.origin);

    // Wait for the MAIN world to create the dropdown.
    // Uses postMessage (not CustomEvent.detail) because CustomEvent.detail
    // is not accessible when crossing from MAIN world to isolated world.
    function handleDropdownReady(e: MessageEvent) {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data?.key !== SyncKey.DropdownReady) {
        return;
      }

      if (e.data.value?.contentId !== panelContentId) {
        return;
      }

      removeEventListener("message", handleDropdownReady);

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
        props: {
          videoData: currentVideoData,
          options
        }
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
    }

    pendingDropdownListener = handleDropdownReady;
    addEventListener("message", handleDropdownReady);
  }

  function closePanel() {
    if (pendingDropdownListener) {
      removeEventListener("message", pendingDropdownListener);
      pendingDropdownListener = null;
    }

    if (panelInstance) {
      void unmount(panelInstance);
      panelInstance = null;
    }

    if (elDropdown) {
      postMessage({
        namespace: SYNC_NAMESPACE,
        key: SyncKey.CloseDropdown,
        value: { videoId }
      }, location.origin);
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

  function attachDownloadButton(element: Element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    elDownloadBtn = element;
    refreshDownloadButton();
  }

  $effect(() => {
    const clicked = buttonClickSignal.value;
    if (clicked?.buttonId && elDownloadBtn?.getAttribute("data-ytdl-button-id") === clicked.buttonId) {
      void handleDownloadClick();
    }
  });

  function refreshChevronButton() {
    if (!elChevronBtn) {
      return;
    }

    setButtonData(elChevronBtn, {
      iconName: isPanelOpen ? IconName.ExpandLess : IconName.ExpandMore,
      title: "",
      accessibilityText: "Download options",
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: !videoData?.isDownloadable ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled: !videoData?.isDownloadable,
      tooltip: "Options"
    });
  }

  function attachChevronButton(element: Element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    elChevronBtn = element;
    refreshChevronButton();
    element.setAttribute("style", "margin-left: 0 !important");
  }

  $effect(() => {
    const clicked = buttonClickSignal.value;
    if (clicked?.buttonId && elChevronBtn?.getAttribute("data-ytdl-button-id") === clicked.buttonId) {
      togglePanel();
    }
  });

  function attachButtonGroup(element: Element) {
    if (element instanceof HTMLElement) {
      elButtonGroup = element;
    }
  }
</script>

<div class="ytdl-button-group" {@attach attachButtonGroup}>
  {#if videoData?.isDownloadable}
    <div class="ytdl-button-row">
      <yt-button-view-model {@attach attachDownloadButton}
      ></yt-button-view-model>
      <yt-button-view-model {@attach attachChevronButton}
      ></yt-button-view-model>
      {#if isDownloading}
        <tp-yt-paper-progress
          class="ytdl-progress-bar"
          aria-label={getButtonTooltip()}
          value={Math.round(displayProgress)}
        ></tp-yt-paper-progress>
      {/if}
    </div>
  {:else if !videoData && !isLoadFailed}
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
    align-items: center;
    overflow: hidden;
  }

  .ytdl-progress-bar {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    block-size: 3px;
  }

  .ytdl-spinner-container {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 8px;
  }
</style>
