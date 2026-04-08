<script lang="ts">
  import DownloadOptions from "./DownloadOptions.svelte";
  import panelFocusStyles from "./panel-focus.css?inline";
  import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
  import { statusProgressItem, videoQueueItem } from "@/lib/storage";
  import { cancelRequestSignal, downloadProgressStore, SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";
  import { getCompatibleFilename, getOutputExtension, resolveAutoExtension, waitForVideoElement } from "@/lib/utils";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    IconName,
    type AdaptiveFormatItem,
    type ButtonViewModelData,
    DownloadType,
    type Options,
    ProgressType,
    isPolymerProgressElement,
    type VideoData
  } from "@/types";
  import { untrack } from "svelte";

  // Grab Polymer's scoping class from an existing action-bar button so that
  // yt-button-view-model elements in this panel receive identical styling.
  const scopingClass =
    document.querySelector("[data-ytdl-download-group] yt-button-view-model")?.getAttribute("class") ??
    document.querySelector("yt-button-view-model")?.getAttribute("class") ??
    "";

  type Props = {
    videoData: VideoData;
    options: Options;
  };

  const { videoData, options }: Props = $props();

  // -- Download state ---------------------------------------------------------
  // State persists for the lifetime of the component (one per video).
  // Closing/reopening the dropdown does not remount this component, so all
  // download progress is preserved across panel open/close cycles.

  let isDownloading = $state(false);
  let isDone = $state(false);
  let progress = $state(0);
  let progressType = $state<ProgressType | "">("");

  // -- Format selection -------------------------------------------------------

  let downloadType = $state<DownloadType>(
    untrack(() => {
      if (options.defaultDownloadType !== "auto") {
        return options.defaultDownloadType;
      }

      return videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
    })
  );
  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => videoData.videoFormats[0] ?? null)
  );
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => videoData.audioFormats[0] ?? null)
  );
  let filename = $state(untrack(() => videoData.title));
  let extension = $state(
    untrack(() => {
      const extPref = videoData.isMusic ? options.ext.audio : options.ext.video;
      const defaultFormat = videoData.isMusic
        ? videoData.audioFormats[0]
        : videoData.videoFormats[0];
      return resolveAutoExtension(extPref, defaultFormat?.mimeType ?? "", videoData.isMusic ? DownloadType.Audio : DownloadType.Video);
    })
  );

  // -- Derived ----------------------------------------------------------------

  // Keep the displayed extension in sync with the actual output container.
  // FFmpeg may produce webm/mkv instead of the user's default extension when
  // the selected video and audio codecs require a different container.
  const actualExtension = $derived.by(() => {
    if (downloadType === DownloadType.Audio) {
      return extension;
    }

    if (!selectedVideoFormat || !selectedAudioFormat) {
      return extension;
    }

    return getOutputExtension(selectedVideoFormat.mimeType, selectedAudioFormat.mimeType, extension);
  });

  const isDownloadable = $derived(videoData.isDownloadable);
  // Weighted progress: download = 0-80%, mux = 80-100%
  const displayProgress = $derived.by(() => {
    if (!isDownloading) {
      return 0;
    }

    if (progressType === ProgressType.FFmpeg) {
      return 80 + progress * 20;
    }

    return progress * 80;
  });
  const fullFilename = $derived(getCompatibleFilename(`${filename}.${actualExtension}`));

  const qualityLabel = $derived(() => {
    if (downloadType === DownloadType.Audio) {
      if (!selectedAudioFormat) {
        return "";
      }

      return `${Math.floor(selectedAudioFormat.bitrate / 1000)} kbps`;
    }

    if (!selectedVideoFormat) {
      return "";
    }

    const isPremium = selectedVideoFormat.qualityLabel?.includes("Premium") ?? false;
    const base = `${selectedVideoFormat.height}p${selectedVideoFormat.fps ? ` ${selectedVideoFormat.fps}fps` : ""}`;
    return isPremium ? `${base} (Enhanced)` : base;
  });

  // Notify the MAIN world download button tooltip when filename or quality changes
  $effect(() => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.FilenameChanged, {
      filename: fullFilename,
      quality: qualityLabel(),
      videoItag: selectedVideoFormat?.itag,
      audioItag: selectedAudioFormat?.itag
    });
  });

  // -- Video quality matching -------------------------------------------------

  async function matchVideoFormatToCurrentQuality() {
    try {
      const elVideo = await waitForVideoElement();
      const currentQuality = Math.min(elVideo.videoHeight, elVideo.videoWidth);
      selectedVideoFormat =
        videoData.videoFormats.find(
          format => Math.min(format.height ?? 0, format.width ?? 0) === currentQuality
        ) ?? videoData.videoFormats[0] ?? null;
    } catch {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
    }
  }

  $effect(() => {
    if (options.videoQualityMode === "current-quality") {
      void matchVideoFormatToCurrentQuality();
      const elVideo = document.querySelector("video");
      function onCanPlay() {
        void matchVideoFormatToCurrentQuality();
      }
      elVideo?.addEventListener("canplay", onCanPlay);
      return () => elVideo?.removeEventListener("canplay", onCanPlay);
    }

    if (options.videoQualityMode === "best") {
      selectedVideoFormat = videoData.videoFormats[0] ?? null;
      return;
    }

    selectedVideoFormat =
      videoData.videoFormats.find(
        format => Math.min(format.height ?? 0, format.width ?? 0) === options.videoQuality
      ) ?? videoData.videoFormats[0] ?? null;
  });

  // -- Restore existing download state on mount -------------------------------

  $effect(() => {
    async function restoreProgress() {
      const currentProgress = await statusProgressItem.getValue();
      const existing = currentProgress[videoData.videoId];
      if (!existing) {
        return;
      }

      progress = existing.progress;
      progressType = existing.progressType;
      isDownloading = existing.progress > 0 && existing.progress < 1;
      isDone = existing.progress >= 1;
    }

    void restoreProgress();
  });

  // -- Progress updates -------------------------------------------------------

  // Reactively sync progress from the shared download progress store
  $effect(() => {
    const state = downloadProgressStore.get(videoData.videoId);
    if (!state) {
      progress = 0;
      progressType = "";
      isDownloading = false;
      isDone = false;
      return;
    }

    isDownloading = state.isDownloading;
    isDone = state.isDone;
    progress = state.progress;
    progressType = state.progressType;
  });

  // -- Queue position tracking ------------------------------------------------

  function onQueueChange(queue: { videoId: string }[] | null) {
    const currentQueue = queue ?? [];
    const isCurrentlyProcessing = currentQueue[0]?.videoId === videoData.videoId;
    if (isCurrentlyProcessing) {
      progress = 0;
      progressType = "";
    }
  }

  $effect(() => videoQueueItem.watch(onQueueChange));

  // -- Filename validation ------------------------------------------------------

  let isFilenameValid = $state(true);

  // -- Inert focus trap --------------------------------------------------------

  let removeInert: (() => void) | null = null;

  function releaseInertTrap() {
    removeInert?.();
    removeInert = null;
  }

  // -- Actions ----------------------------------------------------------------

  function closePanel() {
    releaseInertTrap();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelClosed, {});
    // Also dispatch DOM event for grid/playlist panels where crossWorldMessenger
    // panelClosed listener is owned by the watch page
    document.dispatchEvent(new CustomEvent("ytdl:panel-closed"));
  }

  function handleDownloadTypeChange(newType: DownloadType) {
    isDownloading = false;
    progress = 0;
    downloadType = newType;
    const extPref = newType === DownloadType.Audio ? options.ext.audio : options.ext.video;
    const format = newType === DownloadType.Audio ? selectedAudioFormat : selectedVideoFormat;
    extension = resolveAutoExtension(extPref, format?.mimeType ?? "", newType === DownloadType.Audio ? DownloadType.Audio : DownloadType.Video);
  }

  function startDownload() {
    if (isDownloading || !isDownloadable || !isFilenameValid || !selectedAudioFormat) {
      return;
    }

    if (downloadType !== DownloadType.Audio && !selectedVideoFormat) {
      return;
    }

    isDownloading = true;
    isDone = false;
    progress = 0;

    if (downloadType === DownloadType.VideoAndAudio) {
      progressType = "";
    }

    downloadProgressStore.unsuppress(videoData.videoId);
    downloadProgressStore.set(videoData.videoId, {
      isDownloading: true,
      isDone: false,
      isQueued: false,
      progress: 0,
      progressType: ""
    });

    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, {
      type: downloadType,
      videoId: videoData.videoId,
      videoItag: selectedVideoFormat?.itag ?? 0,
      audioItag: selectedAudioFormat.itag,
      filenameOutput: fullFilename,
      sabrConfig: videoData.sabrConfig
    });
  }

  function cancelDownload() {
    isDownloading = false;
    progress = 0;

    downloadProgressStore.delete(videoData.videoId);

    cancelRequestSignal.value = { videoIds: [videoData.videoId] };
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      closePanel();
    }
  }

  function handleActivationKeydown(callback: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        callback();
      }
    };
  }

  function handleDownloadKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      startDownload();
    }
  }

  // -- YouTube native button attach functions ---------------------------------
  let buttonIdCounter = 0;

  function dispatchButtonData(elButton: Element, data: ButtonViewModelData) {
    if (!elButton.hasAttribute("data-ytdl-button-id")) {
      elButton.setAttribute("data-ytdl-button-id", `panel-btn-${buttonIdCounter++}`);
    }

    postMessage({
      namespace: SYNC_NAMESPACE,
      key: SyncKey.SetButtonData,
      value: {
        selector: `[data-ytdl-button-id="${elButton.getAttribute("data-ytdl-button-id")}"]`,
        data
      }
    }, location.origin);
  }

  function attachCloseButton(elTarget: Element) {
    const closeData: ButtonViewModelData = {
      iconName: IconName.Close,
      title: "",
      accessibilityText: "Close",
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Default,
      state: ButtonState.Active,
      isFullWidth: false,
      isDisabled: false,
      tooltip: ""
    };

    dispatchButtonData(elTarget, closeData);

    // Show "Close" tooltip only on keyboard focus (Tab), not on mouse hover.
    // Polymer's tp-yt-paper-tooltip shows on both hover and focus by default,
    // so we dynamically set the tooltip text only when :focus-visible matches.
    // Polymer renders the inner <button> asynchronously, so we observe until
    // it appears rather than relying on requestAnimationFrame timing.
    function onButtonAvailable(elButton: HTMLButtonElement) {
      elButton.addEventListener("focus", () => {
        if (!elButton.matches(":focus-visible")) {
          return;
        }

        dispatchButtonData(elTarget, {
          ...closeData,
          tooltip: "Close"
        });
      });

      elButton.addEventListener("blur", () => {
        dispatchButtonData(elTarget, closeData);
      });
    }

    const elButton = elTarget.querySelector("button");
    if (elButton) {
      onButtonAvailable(elButton);
    } else {
      const observer = new MutationObserver(() => {
        const elInner = elTarget.querySelector("button");
        if (!elInner) {
          return;
        }

        observer.disconnect();
        onButtonAvailable(elInner);
      });
      observer.observe(elTarget, {
        childList: true,
        subtree: true
      });
    }
  }

  function attachCancelButton(elButton: Element) {
    dispatchButtonData(elButton, {
      iconName: "",
      title: "Cancel",
      accessibilityText: "Cancel",
      style: ButtonStyle.Mono,
      type: ButtonType.Tonal,
      buttonSize: ButtonSize.Small,
      state: ButtonState.Active,
      isFullWidth: false,
      isDisabled: false,
      tooltip: ""
    });
  }

  function attachDownloadButton(elButton: Element) {
    $effect(() => {
      dispatchButtonData(elButton, {
        iconName: IconName.Download,
        title: "Download",
        accessibilityText: "Download",
        style: ButtonStyle.CallToAction,
        type: ButtonType.Filled,
        buttonSize: ButtonSize.Default,
        state: isDownloadable && isFilenameValid ? ButtonState.Active : ButtonState.Disabled,
        isFullWidth: true,
        isDisabled: !isDownloadable || !isFilenameValid,
        tooltip: ""
      });
    });
  }

  function attachPanelProgress(elProgress: Element) {
    if (!isPolymerProgressElement(elProgress)) {
      return;
    }

    elProgress.updateStyles({
      "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
      "--paper-progress-container-color": "transparent"
    });
  }

  // -- Focus management --------------------------------------------------------

  /**
   * Marks all elements outside the panel's ancestor chain as `inert`,
   * creating a native focus trap without manual Tab/Shift-Tab interception.
   * Returns a cleanup function that removes the inert attributes.
   */
  function applyInertTrap(elPanel: HTMLElement) {
    const inertedElements: HTMLElement[] = [];

    // Walk from the panel up to body, marking siblings of each ancestor as inert.
    // This keeps the panel and its container chain focusable while everything
    // else on the page becomes inert (unfocusable + hidden from assistive tech).
    for (let elAncestor = elPanel; elAncestor && elAncestor !== document.body; elAncestor = elAncestor.parentElement!) {
      for (const elSibling of elAncestor.parentElement?.children ?? []) {
        if (elSibling === elAncestor || !(elSibling instanceof HTMLElement) || elSibling.inert) {
          continue;
        }

        elSibling.inert = true;
        inertedElements.push(elSibling);
      }
    }

    return () => {
      for (const elProgress of inertedElements) {
        elProgress.inert = false;
      }
    };
  }

  function attachPanel(elPanel: Element) {
    if (!(elPanel instanceof HTMLElement)) {
      return;
    }

    // The MAIN world bridges Polymer's receivedFocusFromKeyboard property
    // to a [keyboard-focused] attribute on tp-yt-paper-dropdown-menu.
    // Target that attribute so the focus ring only appears for keyboard users.
    const elFocusStyle = document.createElement("style");
    elFocusStyle.textContent = panelFocusStyles;
    elPanel.append(elFocusStyle);

    // Clear stale focus state from a previous panel session so focus always
    // starts fresh on the first dropdown.
    for (const elDropdown of elPanel.querySelectorAll("tp-yt-paper-dropdown-menu")) {
      elDropdown.removeAttribute("keyboard-focused");
      elDropdown.removeAttribute("focused");
      elDropdown.querySelector("tp-yt-paper-menu-button")?.removeAttribute("focused");
      elDropdown.querySelector("tp-yt-paper-input")?.removeAttribute("focused");
    }

    const elInitialFocus = elPanel.querySelector<HTMLElement>("tp-yt-paper-input:not([disabled])");
    elInitialFocus?.focus();

    // The panel always opens via keyboard (Enter on chevron), so the initial
    // focus is keyboard-initiated. Set the attribute directly because Polymer's
    // receivedFocusFromKeyboard may not be initialized yet at mount time.
    elInitialFocus?.closest("tp-yt-paper-dropdown-menu")?.setAttribute("keyboard-focused", "");

    // Apply the inert focus trap AFTER Polymer opens the dropdown.
    // Applying it before open() interferes with Polymer's overlay mechanics.
    const elDropdownRoot = elPanel.closest<HTMLElement>("tp-yt-iron-dropdown") ?? elPanel;

    elDropdownRoot.addEventListener("iron-overlay-opened", () => {
      removeInert = applyInertTrap(elDropdownRoot);

      // Release the inert trap when Polymer closes the overlay externally
      // (click-outside or Escape key) - closePanel() only handles explicit close.
      // Registered here so it only fires after a successful open.
      elDropdownRoot.addEventListener("iron-overlay-closed", releaseInertTrap, { once: true });
    });

    // Polymer's IronFocusedBehavior doesn't always clear the focused attribute
    // from sibling dropdowns when Tab moves between them. Explicitly clear stale
    // focused state so only the active dropdown shows the focus ring.
    function onFocusIn() {
      for (const elDropdown of elPanel.querySelectorAll("tp-yt-paper-dropdown-menu[focused]")) {
        if (elDropdown.contains(document.activeElement)) {
          continue;
        }

        elDropdown.removeAttribute("focused");
        elDropdown.querySelector("tp-yt-paper-menu-button")?.removeAttribute("focused");
        elDropdown.querySelector("tp-yt-paper-input")?.removeAttribute("focused");
      }
    }

    document.addEventListener("focusin", onFocusIn);

    return () => {
      releaseInertTrap();
      document.removeEventListener("focusin", onFocusIn);
      elFocusStyle.remove();
    };
  }

</script>

{#snippet cancelBtn()}
  <yt-button-view-model
    class={scopingClass}
    {@attach attachCancelButton}
    onclick={cancelDownload}
    onkeydown={handleActivationKeydown(cancelDownload)}
    role="button"
    tabindex="0"
  ></yt-button-view-model>
{/snippet}

<div
  class="ytdl-panel"
  {@attach attachPanel}
  aria-labelledby="ytdl-panel-title"
  aria-modal="true"
  onkeydown={handleKeydown}
  role="dialog"
  tabindex="-1"
>
  <div class="ytdl-panel-header">
    <h2 id="ytdl-panel-title" class="ytdl-panel-title">Download options</h2>
    <yt-button-view-model
      class={scopingClass}
      {@attach attachCloseButton}
      aria-label="Close"
      onclick={closePanel}
      onkeydown={handleActivationKeydown(closePanel)}
      role="button"
      tabindex="0"
    ></yt-button-view-model>
  </div>

  <div class="ytdl-panel-body">
    <DownloadOptions
      audioFormats={videoData.audioFormats}
      {downloadType}
      extension={actualExtension}
      {filename}
      {isDownloading}
      onaudioformatchange={format => (selectedAudioFormat = format)}
      ondownloadtypechange={handleDownloadTypeChange}
      onextensionchange={newExtension => (extension = newExtension)}
      onfilenamechange={newFilename => (filename = newFilename)}
      onvalidationchange={isValid => (isFilenameValid = isValid)}
      onvideoformatchange={format => (selectedVideoFormat = format)}
      {selectedAudioFormat}
      {selectedVideoFormat}
      videoFormats={videoData.videoFormats}
    />
  </div>

  <div class="ytdl-panel-footer">
    {#if isDownloading}
      <div class="ytdl-progress-section">
        <tp-yt-paper-progress
          {@attach attachPanelProgress}
          value={Math.round(displayProgress)}
        ></tp-yt-paper-progress>
        <div class="ytdl-progress-row">
          <span class="ytdl-progress-label" aria-live="polite">
            {Math.round(displayProgress)}% - {progressType === ProgressType.FFmpeg ? "Processing" : "Downloading"}
          </span>
          {@render cancelBtn()}
        </div>
      </div>
    {:else if isDone}
      <div class="ytdl-done-status" role="status">
        <svg
          aria-hidden="true"
          fill="currentColor"
          height="20"
          viewBox="0 0 24 24"
          width="20"
        >
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
        <span>Download complete</span>
      </div>
    {:else}
      <yt-button-view-model
        class={scopingClass}
        {@attach attachDownloadButton}
        onclick={startDownload}
        onkeydown={handleDownloadKeydown}
        role="button"
        tabindex="0"
      ></yt-button-view-model>
    {/if}
  </div>
</div>

<style>
  .ytdl-panel {
    overflow: hidden;
    width: 380px;
    color: var(--yt-spec-text-primary, inherit);
  }

  .ytdl-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-block: 20px 16px;
    padding-inline: 24px;
  }

  .ytdl-panel-title {
    margin: 0;
    font-weight: 400;
    font-size: 1.6rem;
    line-height: 1.375;
  }

  .ytdl-panel-body {
    padding: 0 24px;
  }

  .ytdl-panel-footer {
    min-height: 52px;
    padding-block: 16px 20px;
    padding-inline: 24px;
  }

  .ytdl-progress-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ytdl-progress-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .ytdl-progress-label {
    font-size: 1.3rem;
  }

  .ytdl-done-status {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 1.3rem;
  }
</style>
