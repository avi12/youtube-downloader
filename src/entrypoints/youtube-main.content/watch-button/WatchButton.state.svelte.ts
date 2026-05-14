import { performDownload } from "../video/download";
import { buildInitialDownloadState } from "./watch-button-state";
import { buildChevronData, buildDownloadData } from "./watch-button-view-model";
import { createButtonElementEffects } from "./WatchButton.button-effects.svelte";
import { createMessageEffects } from "./WatchButton.message-effects.svelte";
import { createPanelEffects } from "./WatchButton.panel-effects.svelte";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
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

  createButtonElementEffects(
    () => elDownloadButton,
    () => elChevronButton,
    () => downloadData,
    () => chevronData,
    () => params.elDropdown
  );

  createPanelEffects(
    () => elGroup,
    () => elChevronButton,
    () => params.elDropdown,
    () => isPanelOpen,
    () => isPanelBelow,
    value => {
      isPanelOpen = value;
    },
    value => {
      isPanelBelow = value;
    }
  );

  createMessageEffects(
    params.videoData.videoId,
    {
      setIsDownloading(value) {
        isDownloading = value;
      },
      setIsDone(value) {
        isDone = value;
      },
      setIsError(value) {
        isError = value;
      },
      setIsInterrupted(value) {
        isInterrupted = value;
      },
      setDownloadProgress(value) {
        downloadProgress = value;
      },
      setDownloadProgressType(value) {
        downloadProgressType = value;
      },
      setLastProgressReported(value) {
        lastProgressReported = value;
      },
      getIsDone: () => isDone,
      getLastProgressReported: () => lastProgressReported
    },
    () => isPanelOpen,
    value => {
      isPanelOpen = value;
    },
    value => {
      defaultFilename = value;
    },
    value => {
      defaultQuality = value;
    },
    value => {
      defaultVideoItag = value;
    },
    value => {
      defaultAudioItag = value;
    },
    value => {
      defaultAudioTrackId = value;
    },
    () => params.elDropdown
  );

  function handleClick(e: Event) {
    const { target } = e;
    if (!(target instanceof Node)) {
      return;
    }

    if (elDownloadButton?.contains(target)) {
      if (!params.videoData.isDownloadable) {
        return;
      }

      if (isDownloading || isInterrupted) {
        isDownloading = false;
        isInterrupted = false;
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, {
          videoIds: [params.videoData.videoId]
        });
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
