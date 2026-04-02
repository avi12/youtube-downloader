<script lang="ts">
  import { videoQueueItem } from "../lib/storage";
  import {
    cancelRequestSignal,
    downloadProgressStore,
    type DownloadProgressState,
    downloadRequestSignal,
    videoDataRequests,
    videoDataStore
  } from "../lib/synced-stores.svelte";
  import { getCompatibleFilename } from "../lib/utils";
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
    isDownloading: false, isDone: false, isQueued: false, progress: 0, progressType: ""
  };

  const downloadState = $derived(downloadProgressStore.get(videoId) ?? defaultProgressState);
  const isDownloading = $derived(downloadState.isDownloading);
  const isDone = $derived(downloadState.isDone);
  const isQueued = $derived(downloadState.isQueued);
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

  // Reactively refresh the download button when shared download state changes
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    downloadState;
    refreshDownloadButton();
  });

  // Track queue position - update shared store
  $effect(() => videoQueueItem.watch(queue => {
    const currentQueue = queue ?? [];
    const isInQueue = currentQueue.some(item => item.videoId === videoId);
    const isCurrentlyDownloading = currentQueue[0]?.videoId === videoId;
    const current = downloadProgressStore.get(videoId) ?? { ...defaultProgressState };
    current.isQueued = isInQueue && !isCurrentlyDownloading;
    downloadProgressStore.set(videoId, current);
  }));

  const buttonLabel = $derived(() => {
    if (!videoData?.isDownloadable) {
      return "N/A";
    }

    if (isDone) {
      return "Done";
    }

    if (isQueued) {
      return "Queued";
    }

    if (isDownloading) {
      return "Cancel";
    }

    return "Download";
  });

  const selectedVideoFormat = $derived(
    videoData?.videoFormats[0] ?? null
  );
  const selectedAudioFormat = $derived(
    videoData?.audioFormats[0] ?? null
  );

  function toggleDownload() {
    if (!videoData?.isDownloadable) {
      return;
    }

    if (isDownloading) {
      downloadProgressStore.delete(videoId);
      cancelRequestSignal.value = { videoIds: [videoId] };
      return;
    }

    const filenameOutput = getCompatibleFilename(
      `${videoData.title}.${videoData.isMusic ? options.ext.audio : options.ext.video}`
    );

    downloadRequestSignal.value = {
      type: videoData.isMusic ? "audio" : "video+audio",
      videoId,
      videoItag: selectedVideoFormat?.itag ?? 0,
      audioItag: selectedAudioFormat?.itag ?? 0,
      filenameOutput,
      sabrConfig: videoData.sabrConfig
    };

    downloadProgressStore.set(videoId, {
      isDownloading: true, isDone: false, isQueued: false, progress: 0, progressType: ""
    });
  }

  function getItemIconName() {
    if (isDone) {
      return IconName.Downloaded;
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

  // Weighted progress: download phase = 0-80%, mux phase = 80-100%
  // Both phases report their own 0-1 progress, combined into a single 0-100 value
  const displayProgress = $derived.by(() => {
    if (!isDownloading) {
      return 0;
    }

    const isMuxPhase = downloadState.progressType === "ffmpeg";
    if (isMuxPhase) {
      return 80 + downloadState.progress * 20;
    }

    return downloadState.progress * 80;
  });

  function getProgressTooltip() {
    if (!isDownloading || downloadState.progress <= 0) {
      return buttonLabel();
    }

    const phase = downloadState.progressType === "ffmpeg" ? "Processing" : "Downloading";
    return `${Math.round(displayProgress)}% - ${phase}`;
  }

  function refreshDownloadButton() {
    if (!elDownloadBtn) {
      return;
    }

    const tooltip = isDownloading ? getProgressTooltip() : buttonLabel();

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

  function setButtonData(element: Element, data: Record<string, unknown>) {
    element.dispatchEvent(new CustomEvent("ytdl:set-yt-button-data", {
      detail: data,
      bubbles: true
    }));
  }

  function openPanel() {
    if (!videoData || !elButtonGroup) {
      return;
    }

    const currentVideoData = videoData;    if (elDropdown) {
      return;
    }

    // Create dropdown via MAIN world bridge - Polymer elements need the
    // MAIN world's Polymer runtime to function (open/close, positioning).
    const panelContentId = `ytdl-grid-panel-${videoId}`;

    document.dispatchEvent(new CustomEvent("ytdl:create-dropdown", {
      detail: {
        contentId: panelContentId,
        positionTargetSelector: `[data-ytdl-grid-item="${videoId}"]`
      }
    }));

    // Wait for the MAIN world to create the dropdown
    function handleDropdownReady(e: Event) {
      if (!(e instanceof CustomEvent) || e.detail?.contentId !== panelContentId) {
        return;
      }

      document.removeEventListener("ytdl:dropdown-ready", handleDropdownReady);

      const elContent = document.getElementById(panelContentId);
      if (!elContent) {
        return;
      }

      elDropdown = elContent.closest("tp-yt-iron-dropdown");

      panelInstance = mount(DownloadOptionsPanel, {
        target: elContent,
        props: { videoData: currentVideoData, options }
      });

      requestAnimationFrame(() => {
        document.dispatchEvent(new CustomEvent("ytdl:open-dropdown", { detail: { contentId: panelContentId } }));
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

    document.addEventListener("ytdl:dropdown-ready", handleDropdownReady);
  }

  function closePanel() {
    if (panelInstance) {
      unmount(panelInstance);
      panelInstance = null;
    }

    if (elDropdown) {
      document.dispatchEvent(new CustomEvent("ytdl:close-dropdown", { detail: { videoId } }));
      elDropdown = null;
    }
  }

  function togglePanel() {
    isPanelOpen = !isPanelOpen;

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

    element.addEventListener("click", e => {
      e.stopPropagation();
      e.preventDefault();
      toggleDownload();
    });

    refreshDownloadButton();
  }

  function attachChevronButton(element: Element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.addEventListener("click", e => {
      e.stopPropagation();
      e.preventDefault();
      togglePanel();
    });

    setButtonData(element, {
      iconName: IconName.ExpandMore,
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

    element.setAttribute("style", "margin-left: 0 !important");
  }

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
    </div>
    {#if isDownloading}
      <tp-yt-paper-progress
        class="ytdl-progress-bar"
        aria-label={getProgressTooltip()}
        value={Math.round(displayProgress)}
      ></tp-yt-paper-progress>
    {/if}
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
    display: flex;
    align-items: center;
  }

  .ytdl-progress-bar {
    width: 100%;
    height: 3px;
    margin-top: 2px;
  }

  .ytdl-spinner-container {
    display: flex;
    align-items: center;
    height: 36px;
    padding: 0 8px;
  }
</style>
