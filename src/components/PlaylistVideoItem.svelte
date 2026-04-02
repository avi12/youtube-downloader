<script lang="ts">
  import { crossWorldMessenger } from "../lib/cross-world-messenger";
  import { sendMessage } from "../lib/messaging";
  import { videoQueueItem } from "../lib/storage";
  import { getCompatibleFilename } from "../lib/utils";
  import type { Options, VideoData } from "../types";
  import DownloadOptionsPanel from "./DownloadOptionsPanel.svelte";
  import { mount, unmount } from "svelte";

  type Props = {
    videoId: string;
    options: Options;
  };

  const { videoId, options }: Props = $props();

  let videoData = $state<VideoData | null>(null);
  let isDownloading = $state(false);
  let isDone = $state(false);
  let isQueued = $state(false);
  // Listen for video data dispatched by the orchestrator via DOM events.
  // Each component filters by videoId. DOM events support multiple listeners
  // unlike crossWorldMessenger which only allows one per message type.
  $effect(() => {
    function handleVideoData(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      if (e.detail.videoId === videoId) {
        videoData = e.detail;
      }
    }

    document.addEventListener("ytdl:video-data-received", handleVideoData);
    crossWorldMessenger.sendMessage("requestVideoData", { videoId });

    return () => document.removeEventListener("ytdl:video-data-received", handleVideoData);
  });

  // Track progress updates via DOM events (same reason as above)
  $effect(() => {
    function handleProgress(e: Event) {
      if (!(e instanceof CustomEvent) || e.detail.videoId !== videoId) {
        return;
      }

      if (e.detail.isRemoved) {
        isDownloading = false;
        isDone = false;
        isQueued = false;
        return;
      }

      isDone = e.detail.progress >= 1;
    }

    document.addEventListener("ytdl:progress-update", handleProgress);

    return () => document.removeEventListener("ytdl:progress-update", handleProgress);
  });

  // Track queue position
  function handleQueueChange(queue: { videoId: string }[] | null) {
    const currentQueue = queue ?? [];
    const isInQueue = currentQueue.some(item => item.videoId === videoId);
    const isCurrentlyDownloading = currentQueue[0]?.videoId === videoId;
    isQueued = isInQueue && !isCurrentlyDownloading;
  }

  $effect(() => videoQueueItem.watch(handleQueueChange));

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

    isDone = false;
    isDownloading = !isDownloading;

    if (!isDownloading || isQueued) {
      await sendMessage("cancelDownload", { videoIds: [videoId] });
      return;
    }

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
      return "DOWNLOAD_DONE";
    }

    if (isDownloading) {
      return "CLOSE";
    }

    return "DOWNLOAD";
  }

  let isPanelOpen = $state(false);
  let elDropdown: HTMLElement | null = null;
  let panelInstance: ReturnType<typeof mount> | null = null;
  let elButtonGroup: HTMLElement | null = null;

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

    if (elDropdown) {
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
        props: { videoData, options }
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

    element.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      toggleDownload();
    });

    setButtonData(element, {
      iconName: getItemIconName(),
      title: "",
      accessibilityText: videoData ? `${buttonLabel()} ${videoData.title}` : buttonLabel(),
      style: "MONO",
      type: "TONAL",
      buttonSize: "DEFAULT",
      state: !videoData?.isDownloadable ? "DISABLED" : "ACTIVE",
      isFullWidth: false,
      isDisabled: !videoData?.isDownloadable,
      tooltip: buttonLabel()
    });
  }

  function attachChevronButton(element: Element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    element.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      togglePanel();
    });

    setButtonData(element, {
      iconName: "EXPAND_MORE",
      title: "",
      accessibilityText: "Download options",
      style: "MONO",
      type: "TONAL",
      buttonSize: "DEFAULT",
      state: !videoData?.isDownloadable ? "DISABLED" : "ACTIVE",
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
  {:else}
    <div style="padding: 4px 8px" aria-busy="true" aria-label="Loading video info">
      <tp-yt-paper-spinner-lite active></tp-yt-paper-spinner-lite>
    </div>
  {/if}
</div>
