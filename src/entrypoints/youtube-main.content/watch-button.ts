import watchButtonStyles from "./watch-button.css?inline";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { interruptedDownloadStore } from "@/lib/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension } from "@/lib/utils";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  type ButtonViewModelData,
  DownloadType,
  IconName,
  type ProgressUpdate,
  type VideoData,
  type YtButtonViewModelElement
} from "@/types";

const VIDEO_ACTION_BUTTON_SELECTORS = [
  "#above-the-fold #top-level-buttons-computed",
  "ytd-watch-metadata #top-level-buttons-computed",
  "#top-level-buttons-computed"
];

let cleanupCurrentButton: (() => void) | null = null;
let injectionGeneration = 0;
let containerSearchAbort: AbortController | null = null;

export function cleanupSegmentedButton() {
  cleanupCurrentButton?.();
  cleanupCurrentButton = null;
  containerSearchAbort?.abort();
  containerSearchAbort = null;
}

async function findVideoActionsContainer() {
  function findFirstVisible() {
    for (const selector of VIDEO_ACTION_BUTTON_SELECTORS) {
      for (const elButton of document.querySelectorAll<HTMLElement>(selector)) {
        if (elButton.offsetWidth > 0 && elButton.offsetHeight > 0) {
          return elButton;
        }
      }
    }

    return null;
  }

  const existing = findFirstVisible();
  if (existing) {
    return existing;
  }

  containerSearchAbort = new AbortController();
  const { signal } = containerSearchAbort;

  return new Promise<HTMLElement | null>(resolve => {
    const observer = new MutationObserver(() => {
      const elVisible = findFirstVisible();
      if (!elVisible) {
        return;
      }

      observer.disconnect();
      resolve(elVisible);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    signal.addEventListener("abort", () => {
      observer.disconnect();
      resolve(null);
    }, { once: true });
  });
}

export async function injectSegmentedDownloadButton(
  videoData: VideoData,
  cancelActiveDownload: (videoId: string) => void
) {
  cleanupSegmentedButton();

  if (!videoData.isDownloadable) {
    return;
  }

  const generation = ++injectionGeneration;

  const elActionsContainer = await findVideoActionsContainer();
  if (!elActionsContainer || generation !== injectionGeneration) {
    return;
  }

  const { videoId } = videoData;
  let defaultVideoItag = videoData.videoFormats[0]?.itag ?? 0;
  let defaultAudioItag = videoData.audioFormats[0]?.itag ?? 0;
  const defaultVideoMime = videoData.videoFormats[0]?.mimeType ?? "video/mp4";
  const defaultAudioMime = videoData.audioFormats[0]?.mimeType ?? "audio/mp4";
  let defaultExtension: string;
  if (videoData.isMusic) {
    defaultExtension = defaultAudioMime.includes("webm") ? "webm" : "m4a";
  } else {
    defaultExtension = getOutputExtension(defaultVideoMime, defaultAudioMime, "mp4");
  }

  let defaultFilename = getCompatibleFilename(`${videoData.title}.${defaultExtension}`);
  let defaultQuality = "";
  const defaultDownloadType: DownloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;

  let isDownloading = false;
  let isDone = false;
  let isInterrupted = false;
  let isPanelOpen = false;
  let downloadProgress = 0;

  // Check for interrupted download from a previous session
  const interrupted = interruptedDownloadStore.get(videoId);
  if (interrupted) {
    isInterrupted = true;
    defaultVideoItag = interrupted.videoItag || defaultVideoItag;
    defaultAudioItag = interrupted.audioItag || defaultAudioItag;
  }

  // Grab Polymer CSS scoping class from last native yt-button-view-model
  const nativeButtons = elActionsContainer.querySelectorAll("yt-button-view-model");
  const scopingClass =
    nativeButtons[nativeButtons.length - 1]?.getAttribute("class") ?? "";

  // Hide YouTube's native Download button.
  // We use setAttribute("style",...) rather than .style property because Polymer
  // overrides the .style getter on yt-button-view-model with a Symbol.
  // We identify it by .data.iconName (set by Polymer) or the inner button's
  // aria-label, rather than assuming position - the Share button sits between
  // like/dislike and Download in the action bar and would otherwise be hidden.
  function findNativeDownloadButton() {
    const buttons = elActionsContainer!.querySelectorAll<YtButtonViewModelElement>("yt-button-view-model");
    for (const button of buttons) {
      if (button.data?.iconName?.includes(IconName.Download)) {
        return button;
      }

      const elInnerButton = button.querySelector("button");
      if (elInnerButton?.getAttribute("aria-label")?.toLowerCase().includes("download")) {
        return button;
      }
    }

    return null;
  }

  const elNativeDownload = findNativeDownloadButton();
  if (elNativeDownload) {
    elNativeDownload.classList.add("ytdl-native-hidden");
  }

  function buildDownloadData() {
    let iconName = IconName.Download;
    if (isDone) {
      iconName = IconName.Downloaded;
    } else if (isDownloading) {
      iconName = IconName.Close;
    }

    let title = "Download";
    let accessibilityText = "Download";
    if (!videoData.isDownloadable) {
      title = "Not downloadable";
      accessibilityText = "Not downloadable";
    } else if (isDone) {
      title = "Download";
      accessibilityText = "Download again";
    } else if (isDownloading) {
      title = "Cancel";
      accessibilityText = "Cancel download";
    } else if (isInterrupted) {
      title = "Resume";
      accessibilityText = "Resume download";
    }

    const isDisabled = !videoData.isDownloadable;

    let tooltip = "";
    if (videoData.isDownloadable) {
      if (isDownloading && downloadProgress > 0) {
        tooltip = `${Math.round(downloadProgress * 100)}%`;
      } else {
        tooltip = defaultQuality ? `${defaultFilename} - ${defaultQuality}` : defaultFilename;
      }
    }

    return {
      iconName,
      title,
      accessibilityText,
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip
    } satisfies ButtonViewModelData;
  }

  function buildChevronData() {
    const isDisabled = (isDownloading && !isDone) || !videoData.isDownloadable;

    return {
      iconName: isPanelOpen ? IconName.ExpandLess : IconName.ExpandMore,
      title: "",
      accessibilityText: isPanelOpen ? "Close download options" : "Open download options",
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
      isFullWidth: false,
      isDisabled,
      tooltip: isPanelOpen ? "Close download options" : "Download options"
    } satisfies ButtonViewModelData;
  }

  // Inject styles once for the download button group
  if (!document.getElementById("ytdl-watch-styles")) {
    const elStyle = document.createElement("style");
    elStyle.id = "ytdl-watch-styles";
    elStyle.textContent = watchButtonStyles;
    document.head.append(elStyle);
  }

  const elGroup = document.createElement("div");
  elGroup.dataset.ytdlDownloadGroup = "true";

  const elDownloadButton = document.createElement("yt-button-view-model");
  const elChevronButton = document.createElement("yt-button-view-model");

  const elProgressBar = document.createElement("tp-yt-paper-progress");
  elProgressBar.classList.add("ytdl-watch-progress");

  elGroup.append(elDownloadButton, elChevronButton, elProgressBar);

  // Polymer's Shady DOM requires updateStyles for CSS custom properties
  elProgressBar.updateStyles({
    "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
    "--paper-progress-container-color": "transparent"
  });

  // Insert group in the slot the native download button occupied.
  if (elNativeDownload) {
    elNativeDownload.insertAdjacentElement("beforebegin", elGroup);
  } else {
    elActionsContainer.append(elGroup);
  }

  const panelContentId = `ytdl-panel-content-${videoId}`;
  const elDropdown = document.createElement("tp-yt-iron-dropdown");

  // ytd-menu-popup-renderer is YouTube's native popup shell: it provides
  // theme-aware background, border-radius, and box-shadow automatically.
  // Its shadow DOM exposes a default <slot>, so our Svelte content mounts
  // as light DOM children and is projected through that slot.
  const elDropdownContentSlot = document.createElement("ytd-menu-popup-renderer");
  elDropdownContentSlot.slot = "dropdown-content";
  elDropdownContentSlot.id = panelContentId;
  elDropdown.append(elDropdownContentSlot);

  const elPopupContainer = document.querySelector("ytd-popup-container") ?? document.body;
  elPopupContainer.append(elDropdown);

  // Set Polymer properties after the element is connected to the DOM
  elDropdown.positionTarget = elGroup;
  elDropdown.horizontalAlign = "left";
  elDropdown.verticalAlign = "top";
  elDropdown.noOverlap = true;
  elDropdown.dynamicAlign = true;
  elDropdown.allowOutsideScroll = false;
  elDropdown.restoreFocusOnClose = false;

  // Notify the isolated world where to mount the Svelte panel.
  // Fire-and-forget: must not await, or the button setup below never runs
  // (sendMessage waits for a response that never comes for void handlers).
  void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelContentReady, {
    contentId: panelContentId,
    videoData
  });

  // Set Polymer scoping class and data AFTER insertion so connectedCallback
  // does not wipe the class attribute
  const scopingClasses = scopingClass.match(/\S+/g) ?? [];
  elDownloadButton.classList.add(...scopingClasses);
  elDownloadButton.data = buildDownloadData();
  elDownloadButton.dataset.ytdlDownload = "true";

  elChevronButton.classList.add(...scopingClasses);
  elChevronButton.data = buildChevronData();
  // [data-ytdl-chevron] suppresses the automatic margin-left between
  // adjacent yt-button-view-model siblings so the buttons sit flush.
  elChevronButton.dataset.ytdlChevron = "true";

  // Polymer renders <button> into light DOM asynchronously.
  // We use a MutationObserver + requestAnimationFrame to apply the classes
  // as soon as the element is available (and after any re-render).
  function applySegmentedClasses() {
    const elDownloadInnerButton = elDownloadButton.querySelector<HTMLButtonElement>("button");
    const elChevronInnerButton = elChevronButton.querySelector<HTMLButtonElement>("button");
    if (elDownloadInnerButton) {
      elDownloadInnerButton.classList.add("yt-spec-button-shape-next--segmented-start");
    }

    if (elChevronInnerButton) {
      elChevronInnerButton.classList.add("yt-spec-button-shape-next--segmented-end");
    }
  }

  const segmentedObserver = new MutationObserver(applySegmentedClasses);
  segmentedObserver.observe(elDownloadButton, {
    childList: true,
    subtree: true
  });
  segmentedObserver.observe(elChevronButton, {
    childList: true,
    subtree: true
  });
  requestAnimationFrame(applySegmentedClasses);

  function refreshButtons() {
    elDownloadButton.data = buildDownloadData();
    elChevronButton.data = buildChevronData();
    requestAnimationFrame(applySegmentedClasses);

    elProgressBar.indeterminate = isDownloading && downloadProgress === 0;
    elProgressBar.value = Math.round(downloadProgress * 100);
    elProgressBar.style.opacity = isDownloading ? "1" : "0";
  }

  function handleClick(e: Event) {
    const { target } = e;
    if (!(target instanceof Node)) {
      return;
    }

    if (elDownloadButton.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      if (isDownloading) {
        isDownloading = false;
        refreshButtons();
        cancelActiveDownload(videoId);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelRequest, { videoIds: [videoId] });
        return;
      }

      isDone = false;
      isInterrupted = false;
      isDownloading = true;
      downloadProgress = 0;
      refreshButtons();
      void crossWorldMessenger.sendMessage(CrossWorldMessage.WatchDownloadRequest, {
        type: defaultDownloadType,
        videoId,
        videoItag: defaultVideoItag,
        audioItag: defaultAudioItag,
        filenameOutput: defaultFilename,
        sabrConfig: null
      });
      return;
    }

    if (elChevronButton.contains(target)) {
      if (!videoData.isDownloadable) {
        return;
      }

      isPanelOpen = !isPanelOpen;
      refreshButtons();

      if (isPanelOpen) {
        // Stop propagation so Polymer's click-outside handler
        // doesn't immediately close the dropdown we just opened
        e.stopPropagation();
        elDropdown.open();
        elChevronButton.querySelector<HTMLButtonElement>("button")?.blur();
      } else {
        elDropdown.close();
      }
    }
  }

  function handleProgress({ data }: { data: ProgressUpdate }) {
    if (data.videoId !== videoId) {
      return;
    }

    if (data.isRemoved) {
      isDownloading = false;
      downloadProgress = 0;
      refreshButtons();
      return;
    }

    downloadProgress = data.progress;

    if (data.progress >= 1) {
      isDone = true;
      isDownloading = false;
      downloadProgress = 0;
    }

    refreshButtons();
  }

  function handlePanelClosed() {
    if (!isPanelOpen) {
      return;
    }

    isPanelOpen = false;
    refreshButtons();
    elDropdown.close();
  }

  // From Polymer (click-outside, Escape key): sync MAIN world state
  function handleDropdownClosed() {
    if (!isPanelOpen) {
      return;
    }

    isPanelOpen = false;
    refreshButtons();
    // Restore focus to the chevron button
    elChevronButton.querySelector<HTMLButtonElement>("button")?.focus();
  }

  // Refit the dropdown whenever the panel content resizes (e.g. switching tabs)
  // so the dropdown stays anchored to the button group rather than floating away.
  const resizeObserver = new ResizeObserver(() => {
    if (elDropdown.opened) {
      elDropdown.refit();
    }
  });
  resizeObserver.observe(elDropdownContentSlot);

  const unsubscribeProgress = crossWorldMessenger.onMessage(CrossWorldMessage.Progress, handleProgress);

  const unsubscribeDownloadProgress = crossWorldMessenger.onMessage(
    CrossWorldMessage.DownloadProgress,
    ({ data }) => {
      if (data.videoId !== videoId) {
        return;
      }

      downloadProgress = data.progress;
      refreshButtons();
    }
  );

  const unsubscribePanelClosed = crossWorldMessenger.onMessage(
    CrossWorldMessage.PanelClosed, () => handlePanelClosed()
  );
  const unsubscribeFilenameChanged = crossWorldMessenger.onMessage(
    CrossWorldMessage.FilenameChanged, ({ data }) => {
      defaultFilename = data.filename;
      defaultQuality = data.quality ?? "";

      if (data.videoItag !== undefined) {
        defaultVideoItag = data.videoItag;
      }

      if (data.audioItag !== undefined) {
        defaultAudioItag = data.audioItag;
      }

      refreshButtons();
    }
  );

  elActionsContainer.addEventListener("click", handleClick);
  elDropdown.addEventListener("iron-overlay-closed", handleDropdownClosed);

  cleanupCurrentButton = () => {
    segmentedObserver.disconnect();
    resizeObserver.disconnect();
    elActionsContainer.removeEventListener("click", handleClick);
    unsubscribeProgress();
    unsubscribeDownloadProgress();
    unsubscribePanelClosed();
    unsubscribeFilenameChanged();
    elDropdown.removeEventListener("iron-overlay-closed", handleDropdownClosed);
    elGroup.remove();
    elDropdown.remove();
    elNativeDownload?.classList.remove("ytdl-native-hidden");
  };
}
