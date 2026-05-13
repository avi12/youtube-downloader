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

export function createWatchButtonState(params: {
  readonly videoData: VideoData;
  readonly elDropdown: import("@/types").TpYtIronDropdownElement;
}) {
  const initial = untrack(() => buildInitialDownloadState(params.videoData));

  let isDownloading = $state(false);
  let isDone = $state(false);
  let isInterrupted = $state(initial.isInterrupted);
  let isError = $state(false);
  let isPanelOpen = $state(false);
  let isPanelBelow = $state(true);
  let downloadProgress = $state(0);
  let downloadProgressType = $state<ProgressType | "">("");
  let defaultVideoItag = $state(initial.videoItag);
  let defaultAudioItag = $state(initial.audioItag);
  let defaultAudioTrackId = $state(initial.audioTrackId);
  let defaultFilename = $state(initial.filename);
  let defaultQuality = $state(initial.quality);
  const defaultDownloadType = initial.downloadType;
  let lastProgressReported = $state("");

  let elGroup = $state<HTMLDivElement | null>(null);
  let elDownloadButton = $state<YtButtonViewModelElement | null>(null);
  let elChevronButton = $state<YtButtonViewModelElement | null>(null);

  const effectiveProgress = $derived.by(() => {
    if (isDownloading) {
      return downloadProgress;
    }

    return isError ? 1 : 0;
  });

  const viewState = $derived({
    isDownloading,
    isDone,
    isInterrupted,
    isError,
    isPanelOpen,
    isPanelBelow,
    downloadProgress: effectiveProgress,
    progressType: downloadProgressType,
    filename: defaultFilename,
    quality: defaultQuality,
    isDownloadable: params.videoData.isDownloadable
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

    params.elDropdown.positionTarget = elChevronButton;
  });

  function syncPanelBelowState() {
    const dropdownRect = params.elDropdown.getBoundingClientRect();
    const isDropdownHidden = dropdownRect.width === 0 && dropdownRect.height === 0;
    if (isDropdownHidden) {
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
      if (e.target !== params.elDropdown) {
        return;
      }

      const groupRect = elGroup?.getBoundingClientRect();
      const dropdownRect = params.elDropdown.getBoundingClientRect();
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
      params.elDropdown.dispatchEvent(
        new CustomEvent("iron-resize", {
          bubbles: false,
          composed: false
        })
      );
      requestAnimationFrame(syncPanelBelowState);
    }

    params.elDropdown.addEventListener("iron-overlay-opened", handleDropdownOpened);
    params.elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);
    params.elDropdown.addEventListener("iron-resize", syncPanelBelowState);
    addEventListener("resize", handleWindowResize);

    return () => {
      params.elDropdown.removeEventListener("iron-overlay-opened", handleDropdownOpened);
      params.elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
      params.elDropdown.removeEventListener("iron-resize", syncPanelBelowState);
      removeEventListener("resize", handleWindowResize);
    };
  });

  $effect(() => onCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    handler(data) {
      if (data.videoId !== params.videoData.videoId) {
        return;
      }

      if (isDone) {
        if (!data.isRemoved) {
          return;
        }

        isDone = false;
        lastProgressReported = "";
      }

      const reportedKey = data.isRemoved ? "" : `${data.progress}|${data.progressType}`;
      const isDuplicateProgress = !data.isRemoved && reportedKey === lastProgressReported;
      if (isDuplicateProgress) {
        return;
      }

      lastProgressReported = data.isRemoved ? "" : reportedKey;

      if (data.isRemoved) {
        isDownloading = false;
        downloadProgress = 0;
        downloadProgressType = "";

        if (data.isFailed) {
          isError = true;
        }

        return;
      }

      isError = false;
      isInterrupted = false;
      downloadProgress = calculateWeightedProgress({
        isDownloading: true,
        progress: data.progress,
        progressType: data.progressType
      }) / 100;
      downloadProgressType = data.progressType;

      const isProcessingComplete = data.progress >= 1 && data.progressType === ProgressType.FFmpeg;
      if (isProcessingComplete) {
        isDone = true;
        isDownloading = false;
        downloadProgress = 0;
        downloadProgressType = "";
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
    params.elDropdown.close();
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

    if (data.audioTrackId !== undefined) {
      defaultAudioTrackId = data.audioTrackId;
    }
  }));

  function handleClick(e: Event) {
    const { target } = e;
    if (!(target instanceof Node)) {
      return;
    }

    if (elDownloadButton?.contains(target)) {
      if (!params.videoData.isDownloadable) {
        return;
      }

      const isDownloadActive = isDownloading || isInterrupted;
      if (isDownloadActive) {
        isDownloading = false;
        isInterrupted = false;
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds: [params.videoData.videoId] });
        return;
      }

      isDone = false;
      isInterrupted = false;
      isError = false;
      void performDownload({
        type: defaultDownloadType,
        videoId: params.videoData.videoId,
        videoItag: defaultVideoItag,
        audioItag: defaultAudioItag,
        audioTrackId: defaultAudioTrackId,
        filenameOutput: defaultFilename
      });
      return;
    }

    if (elChevronButton?.contains(target)) {
      if (!params.videoData.isDownloadable) {
        return;
      }

      isPanelOpen = !isPanelOpen;

      if (isPanelOpen) {
        e.stopPropagation();
        params.elDropdown.open();
        elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
      } else {
        params.elDropdown.close();
      }
    }
  }

  return {
    get elGroup() {
      return elGroup;
    },
    set elGroup(value) {
      elGroup = value;
    },
    get elDownloadButton() {
      return elDownloadButton;
    },
    set elDownloadButton(value) {
      elDownloadButton = value;
    },
    get elChevronButton() {
      return elChevronButton;
    },
    set elChevronButton(value) {
      elChevronButton = value;
    },
    get stateClass() {
      return stateClass;
    },
    get isIndeterminate() {
      return isIndeterminate;
    },
    get isError() {
      return isError;
    },
    get effectiveProgress() {
      return effectiveProgress;
    },
    PROGRESS_RING_RADIUS,
    PROGRESS_RING_SVG_SIZE,
    PROGRESS_RING_CIRCUMFERENCE,
    handleClick
  };
}
