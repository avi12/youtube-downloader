<script lang="ts">
  import { performDownload } from "../video/download";
  import { buildInitialDownloadState } from "./watch-button-state";
  import { buildChevronData, buildDownloadData } from "./watch-button-view-model";
  import { CrossWorldEvent, onCrossWorldEvent } from "@/lib/messaging/cross-world-events";
  import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
  import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
  import { calculateWeightedProgress } from "@/lib/youtube/video-helpers";
  import { ProgressType, type VideoData, type YtButtonViewModelElement } from "@/types";
  import { untrack } from "svelte";

  const PROGRESS_RING_RADIUS = 16;
  const PROGRESS_RING_SVG_SIZE = 40;
  const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RING_RADIUS;

  const {
    videoData,
    elDropdown,
    scopingClasses = [],
    cancelActiveDownload
  }: {
    videoData: VideoData;
    elDropdown: import("@/types").TpYtIronDropdownElement;
    scopingClasses?: string[];
    cancelActiveDownload: (videoId: string) => void;
  } = $props();

  const initial = untrack(() => buildInitialDownloadState(videoData));

  let isDownloading = $state(false);
  let isDone = $state(false);
  let isInterrupted = $state(initial.isInterrupted);
  let isError = $state(false);
  let isPanelOpen = $state(false);
  let isPanelBelow = $state(true);
  let downloadProgress = $state(0);
  let defaultVideoItag = $state(initial.videoItag);
  let defaultAudioItag = $state(initial.audioItag);
  let defaultFilename = $state(initial.filename);
  let defaultQuality = $state(initial.quality);
  const defaultDownloadType = $state(initial.downloadType);
  let lastProgressReported = $state("");

  let elGroup = $state<HTMLDivElement | null>(null);
  let elDownloadButton = $state<YtButtonViewModelElement | null>(null);
  let elChevronButton = $state<YtButtonViewModelElement | null>(null);

  const effectiveProgress = $derived(isDownloading ? downloadProgress : 0);

  const viewState = $derived({
    isDownloading,
    isDone,
    isInterrupted,
    isError,
    isPanelOpen,
    isPanelBelow,
    downloadProgress: effectiveProgress,
    filename: defaultFilename,
    quality: defaultQuality,
    isDownloadable: videoData.isDownloadable
  });

  const downloadData = $derived(buildDownloadData(viewState));
  const chevronData = $derived(buildChevronData(viewState));

  const stateClass = $derived.by(() => {
    if (isDone) {
      return "ytdl-watch-state-done";
    }

    if (isError) {
      return "ytdl-watch-state-error";
    }

    if (isInterrupted) {
      return "ytdl-watch-state-interrupted";
    }

    if (isDownloading) {
      return "ytdl-watch-state-downloading";
    }

    return "";
  });

  const isIndeterminate = $derived(isDownloading && downloadProgress === 0);

  function applySegmentedClasses() {
    elDownloadButton?.querySelector<HTMLButtonElement>("button")?.classList.add("ytSpecButtonShapeNextSegmentedStart");
    elChevronButton?.querySelector<HTMLButtonElement>("button")?.classList.add("ytSpecButtonShapeNextSegmentedEnd");
  }

  $effect(() => {
    if (!elDownloadButton) {
      return;
    }

    elDownloadButton.data = downloadData;
    requestAnimationFrame(applySegmentedClasses);
  });

  $effect(() => {
    if (!elChevronButton) {
      return;
    }

    elChevronButton.data = chevronData;
    requestAnimationFrame(applySegmentedClasses);
  });

  $effect(() => {
    if (!elDownloadButton || !elChevronButton) {
      return;
    }

    const observer = new MutationObserver(() => requestAnimationFrame(applySegmentedClasses));
    observer.observe(elDownloadButton, CHILD_LIST_SUBTREE);
    observer.observe(elChevronButton, CHILD_LIST_SUBTREE);
    requestAnimationFrame(applySegmentedClasses);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (!elChevronButton) {
      return;
    }

    elDropdown.positionTarget = elChevronButton;
  });

  function syncPanelBelowState() {
    const dropdownRect = elDropdown.getBoundingClientRect();
    if (dropdownRect.width === 0 && dropdownRect.height === 0) {
      return;
    }

    const groupRect = elGroup?.getBoundingClientRect();
    if (!groupRect) {
      return;
    }

    const newIsPanelBelow = dropdownRect.top >= groupRect.bottom - 1;
    if (newIsPanelBelow !== isPanelBelow) {
      isPanelBelow = newIsPanelBelow;
    }
  }

  $effect(() => {
    function handleDropdownOpened(e: Event) {
      if (e.target !== elDropdown) {
        return;
      }

      const groupRect = elGroup?.getBoundingClientRect();
      const dropdownRect = elDropdown.getBoundingClientRect();
      if (!groupRect) {
        return;
      }

      isPanelBelow = dropdownRect.top >= groupRect.bottom - 1;
    }

    function handleDropdownClosed() {
      if (!isPanelOpen) {
        return;
      }

      isPanelOpen = false;
      elChevronButton?.querySelector<HTMLButtonElement>("button")?.focus();
    }

    function handleWindowResize() {
      elDropdown.dispatchEvent(
        new CustomEvent("iron-resize", {
          bubbles: false,
          composed: false
        })
      );
      requestAnimationFrame(syncPanelBelowState);
    }

    elDropdown.addEventListener("iron-overlay-opened", handleDropdownOpened);
    elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);
    elDropdown.addEventListener("iron-resize", syncPanelBelowState);
    addEventListener("resize", handleWindowResize);

    return () => {
      elDropdown.removeEventListener("iron-overlay-opened", handleDropdownOpened);
      elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
      elDropdown.removeEventListener("iron-resize", syncPanelBelowState);
      removeEventListener("resize", handleWindowResize);
    };
  });

  $effect(() => onCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    handler(data) {
      if (data.videoId !== videoData.videoId) {
        return;
      }

      if (isDone) {
        if (data.isRemoved) {
          return;
        }

        isDone = false;
        lastProgressReported = "";
      }

      const reportedKey = data.isRemoved ? "" : `${data.progress}|${data.progressType}`;
      if (!data.isRemoved && reportedKey === lastProgressReported) {
        return;
      }

      lastProgressReported = data.isRemoved ? "" : reportedKey;

      if (data.isRemoved) {
        isDownloading = false;
        downloadProgress = 0;

        if (data.isFailed) {
          isError = true;
        }

        return;
      }

      downloadProgress = calculateWeightedProgress({
        isDownloading: true,
        progress: data.progress,
        progressType: data.progressType
      }) / 100;

      if (data.progress >= 1 && data.progressType === ProgressType.FFmpeg) {
        isDone = true;
        isDownloading = false;
        downloadProgress = 0;
      } else {
        isDownloading = true;
      }
    }
  }));

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.PanelClosed, () => {
    if (!isPanelOpen) {
      return;
    }

    isPanelOpen = false;
    elDropdown.close();
  }));

  $effect(() => crossWorldMessenger.onMessage(CrossWorldMessage.FilenameChanged, ({ data }) => {
    defaultFilename = data.filename;
    defaultQuality = data.quality ?? "";

    if (data.videoItag !== undefined) {
      defaultVideoItag = data.videoItag;
    }

    if (data.audioItag !== undefined) {
      defaultAudioItag = data.audioItag;
    }
  }));

  function handleClick(e: Event) {
    const { target } = e;
    if (!(target instanceof Node)) {
      return;
    }

    if (elDownloadButton?.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      if (isDownloading || isInterrupted) {
        isDownloading = false;
        isInterrupted = false;
        cancelActiveDownload(videoData.videoId);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoData.videoId] });
        return;
      }

      isDone = false;
      isInterrupted = false;
      isError = false;
      isDownloading = true;
      downloadProgress = 0;
      void performDownload({
        type: defaultDownloadType,
        videoId: videoData.videoId,
        videoItag: defaultVideoItag,
        audioItag: defaultAudioItag,
        filenameOutput: defaultFilename
      });
      return;
    }

    if (elChevronButton?.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      isPanelOpen = !isPanelOpen;

      if (isPanelOpen) {
        e.stopPropagation();
        elDropdown.open();
        elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
      } else {
        elDropdown.close();
      }
    }
  }
</script>

<div
  bind:this={elGroup}
  class={stateClass}
  data-ytdl-download-group="true"
  onclick={handleClick}
  role="none"
>
  <yt-button-view-model
    bind:this={elDownloadButton}
    class={[...scopingClasses, "ytdl-download-button"].join(" ")}
  ></yt-button-view-model>
  <yt-button-view-model
    bind:this={elChevronButton}
    class={[...scopingClasses, "ytdl-chevron-button"].join(" ")}
  ></yt-button-view-model>
  <svg
    style:opacity={isDownloading ? 1 : 0}
    class={["ytdl-watch-progress-ring", isIndeterminate ? "ytdl-watch-progress-ring--indeterminate" : ""].join(" ")}
    aria-hidden="true"
    viewBox="0 0 {PROGRESS_RING_SVG_SIZE} {PROGRESS_RING_SVG_SIZE}"
  >
    <circle
      class="ytdl-watch-progress-ring__track"
      cx={PROGRESS_RING_SVG_SIZE / 2}
      cy={PROGRESS_RING_SVG_SIZE / 2}
      r={PROGRESS_RING_RADIUS}
    />
    <circle
      class="ytdl-watch-progress-ring__indicator"
      cx={PROGRESS_RING_SVG_SIZE / 2}
      cy={PROGRESS_RING_SVG_SIZE / 2}
      r={PROGRESS_RING_RADIUS}
      stroke-dasharray={PROGRESS_RING_CIRCUMFERENCE}
      stroke-dashoffset={PROGRESS_RING_CIRCUMFERENCE * (1 - effectiveProgress)}
    />
  </svg>
</div>
