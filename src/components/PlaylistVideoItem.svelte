<script lang="ts">
  import { crossWorldMessenger } from "../lib/cross-world-messenger";
  import { getDownloadState, startDownload, cancelDownload as cancelDownloadState } from "../lib/download-state";
  import { sendMessage } from "../lib/messaging";
  import { videoQueueItem } from "../lib/storage";
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
  const downloadState = $derived(getDownloadState(videoId));
  const isDownloading = $derived(downloadState.isDownloading);
  const isDone = $derived(downloadState.isDone);
  const isQueued = $derived(downloadState.isQueued);
  let isLoadFailed = $state(false);

  // Request video data from MAIN world via crossWorldMessenger.
  // Responses arrive via ytdl:video-data-received DOM event dispatched
  // by the orchestrator (same isolated world, so DOM events work).
  $effect(() => {
    function handleVideoData(e: Event) {
      if (!(e instanceof CustomEvent) || e.detail.videoId !== videoId) {
        return;
      }

      videoData = e.detail;
    }

    document.addEventListener("ytdl:video-data-received", handleVideoData);
    crossWorldMessenger.sendMessage("requestVideoData", { videoId });

    const loadTimeout = setTimeout(() => {
      if (!videoData) {
        isLoadFailed = true;
      }
    }, 15_000);

    return () => {
      document.removeEventListener("ytdl:video-data-received", handleVideoData);
      clearTimeout(loadTimeout);
    };
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
    const state = getDownloadState(videoId);
    state.isQueued = isInQueue && !isCurrentlyDownloading;
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

  async function toggleDownload() {
    if (!videoData?.isDownloadable) {
      return;
    }

    if (isDownloading) {
      cancelDownloadState(videoId);
      await sendMessage("cancelDownload", { videoIds: [videoId] });
      return;
    }

    startDownload(videoId);

    const filenameOutput = getCompatibleFilename(
      `${videoData.title}.${videoData.isMusic ? options.ext.audio : options.ext.video}`
    );

    crossWorldMessenger.sendMessage("downloadRequest", {
      type: videoData.isMusic ? "audio" : "video+audio",
      videoId,
      videoItag: selectedVideoFormat?.itag ?? 0,
      audioItag: selectedAudioFormat?.itag ?? 0,
      filenameOutput,
      sabrConfig: videoData.sabrConfig
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

  function refreshDownloadButton() {
    if (!elDownloadBtn) {
      return;
    }

    setButtonData(elDownloadBtn, {
      iconName: getItemIconName(),
      title: "",
      accessibilityText: videoData ? `${buttonLabel()} ${videoData.title}` : buttonLabel(),
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: !videoData?.isDownloadable ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled: !videoData?.isDownloadable,
      tooltip: buttonLabel()
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

    // Wait for the MAIN world to create the dropdown, mount Svelte, then open
    const checkInterval = setInterval(() => {
      const elContent = document.getElementById(panelContentId);
      if (!elContent) {
        return;
      }

      clearInterval(checkInterval);
      elDropdown = elContent.closest("tp-yt-iron-dropdown");

      panelInstance = mount(DownloadOptionsPanel, {
        target: elContent,
        props: { videoData: currentVideoData, options }
      });

      // Open after content is mounted so ytd-menu-popup-renderer sizes correctly
      requestAnimationFrame(() => {
        document.dispatchEvent(new CustomEvent("ytdl:open-dropdown", { detail: { contentId: panelContentId } }));
      });

      function handleClose() {
        isPanelOpen = false;
        closePanel();
        document.removeEventListener("ytdl:panel-closed", handleClose);
      }

      elDropdown?.addEventListener("iron-overlay-closed", handleClose);
      document.addEventListener("ytdl:panel-closed", handleClose);
    }, 50);

    // Timeout after 2s
    setTimeout(() => clearInterval(checkInterval), 2000);
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

<div style="display: flex; align-items: center" {@attach attachButtonGroup}>
  {#if videoData}
    <yt-button-view-model {@attach attachDownloadButton}
    ></yt-button-view-model>
    <yt-button-view-model {@attach attachChevronButton}
    ></yt-button-view-model>
  {:else if !isLoadFailed}
    <div
      style="display: flex; align-items: center; height: 36px; padding: 0 8px"
      aria-busy="true"
      aria-label="Loading video info"
    >
      <tp-yt-paper-spinner-lite active></tp-yt-paper-spinner-lite>
    </div>
  {/if}
</div>
