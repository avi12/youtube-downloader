<script lang="ts">
  import { crossWorldMessenger } from "../lib/cross-world-messenger";
  import { statusProgressItem, videoQueueItem } from "../lib/storage";
  import { downloadProgressStore } from "../lib/synced-stores.svelte";
  import { getCompatibleFilename, waitForVideoElement } from "../lib/utils";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    IconName,
    type AdaptiveFormatItem,
    type ButtonViewModelData,
    type DownloadType,
    type Options,
    type ProgressType,
    type VideoData
  } from "../types";
  import DownloadOptions from "./DownloadOptions.svelte";
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
    untrack(() => (videoData.isMusic ? "audio" : "video+audio"))
  );
  let selectedVideoFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => videoData.videoFormats[0] ?? null)
  );
  let selectedAudioFormat = $state<AdaptiveFormatItem | null>(
    untrack(() => videoData.audioFormats[0] ?? null)
  );
  let filename = $state(untrack(() => videoData.title));
  let extension = $state(
    untrack(() => (videoData.isMusic ? options.ext.audio : options.ext.video))
  );

  // -- Derived ----------------------------------------------------------------

  const isDownloadable = $derived(videoData.isDownloadable);
  // Weighted progress: download = 0-80%, mux = 80-100%
  const displayProgress = $derived.by(() => {
    if (!isDownloading) {
      return 0;
    }

    if (progressType === "ffmpeg") {
      return 80 + progress * 20;
    }

    return progress * 80;
  });
  const fullFilename = $derived(getCompatibleFilename(`${filename}.${extension}`));

  const qualityLabel = $derived(() => {
    if (downloadType === "audio") {
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
    crossWorldMessenger.sendMessage("filenameChanged", {
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
      matchVideoFormatToCurrentQuality();
      const elVideo = document.querySelector("video");
      function onCanPlay() {
        matchVideoFormatToCurrentQuality();
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

    restoreProgress();
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

  // -- Actions ----------------------------------------------------------------

  function closePanel() {
    crossWorldMessenger.sendMessage("panelClosed", {});
    // Also dispatch DOM event for grid/playlist panels where crossWorldMessenger
    // panelClosed listener is owned by the watch page
    document.dispatchEvent(new CustomEvent("ytdl:panel-closed"));
  }

  function handleDownloadTypeChange(newType: DownloadType) {
    isDownloading = false;
    progress = 0;
    downloadType = newType;
    extension = newType === "audio" ? options.ext.audio : options.ext.video;
  }

  async function startDownload() {
    if (isDownloading || !isDownloadable || !selectedAudioFormat) {
      return;
    }

    if (downloadType !== "audio" && !selectedVideoFormat) {
      return;
    }

    isDownloading = true;
    isDone = false;
    progress = 0;

    if (downloadType === "video+audio") {
      progressType = "";
    }

    downloadProgressStore.set(videoData.videoId, {
      isDownloading: true, isDone: false, isQueued: false, progress: 0, progressType: ""
    });

    crossWorldMessenger.sendMessage("downloadRequest", {
      type: downloadType,
      videoId: videoData.videoId,
      videoItag: selectedVideoFormat?.itag ?? 0,
      audioItag: selectedAudioFormat.itag,
      filenameOutput: fullFilename,
      sabrConfig: videoData.sabrConfig
    });
  }

  async function cancelDownload() {
    isDownloading = false;
    progress = 0;

    downloadProgressStore.delete(videoData.videoId);

    crossWorldMessenger.sendMessage("cancelDownload", { videoIds: [videoData.videoId] });
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
  // Named functions (not inlined) so TypeScript can type the `element`
  // parameter without inline type annotations, which Svelte templates reject.
  function dispatchButtonData(element: Element, data: ButtonViewModelData) {
    element.dispatchEvent(new CustomEvent("ytdl:set-yt-button-data", { detail: data, bubbles: true }));
  }

  function attachCloseButton(element: Element) {
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

    dispatchButtonData(element, closeData);

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

        dispatchButtonData(element, { ...closeData, tooltip: "Close" });
      });

      elButton.addEventListener("blur", () => {
        dispatchButtonData(element, closeData);
      });
    }

    const elButton = element.querySelector("button");
    if (elButton) {
      onButtonAvailable(elButton);
    } else {
      const observer = new MutationObserver(() => {
        const elInner = element.querySelector("button");
        if (!elInner) {
          return;
        }

        observer.disconnect();
        onButtonAvailable(elInner);
      });
      observer.observe(element, { childList: true, subtree: true });
    }
  }

  function attachCancelButton(element: Element) {
    dispatchButtonData(element, {
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

  function attachDownloadButton(element: Element) {
    $effect(() => {
      dispatchButtonData(element, {
        iconName: IconName.Download,
        title: "Download",
        accessibilityText: "Download",
        style: ButtonStyle.CallToAction,
        type: ButtonType.Filled,
        buttonSize: ButtonSize.Default,
        state: isDownloadable ? ButtonState.Active : ButtonState.Disabled,
        isFullWidth: true,
        isDisabled: !isDownloadable,
        tooltip: ""
      });
    });
  }

  function attachPanelProgress(element: Element) {
    if (!("updateStyles" in element) || typeof element.updateStyles !== "function") {
      return;
    }

    element.updateStyles({
      "--paper-progress-active-color": "var(--yt-spec-call-to-action, rgb(62 166 255))",
      "--paper-progress-container-color": "transparent"
    });
  }

  // -- Focus trap attach function ---------------------------------------------

  function attachPanel(element: Element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    // The MAIN world bridges Polymer's receivedFocusFromKeyboard property
    // to a [keyboard-focused] attribute on tp-yt-paper-dropdown-menu.
    // Target that attribute so the focus ring only appears for keyboard users.
    const elFocusStyle = document.createElement("style");
    elFocusStyle.textContent = [
      "tp-yt-paper-dropdown-menu[keyboard-focused] tp-yt-paper-input {",
      "  outline: 2px solid var(--yt-spec-call-to-action, rgb(6 95 212));",
      "  outline-offset: 2px;",
      "  border-radius: 2px;",
      "}"
    ].join(" ");
    element.append(elFocusStyle);

    const TABBABLE_SELECTOR = [
      "button:not([disabled])",
      "tp-yt-paper-input:not([disabled])",
      "input:not([disabled]):not([type=\"hidden\"])",
      "a[href]",
      "[tabindex=\"0\"]"
    ].join(", ");

    // Returns the first tabbable element in the panel body/footer, skipping the
    // panel header (Close button). This makes Tab wrap from the last element back
    // to the first content control (Type dropdown), not the Close button.
    // The Close button is still reachable via Shift-Tab from the Type dropdown.
    function getFirstTabbable() {
      for (const candidate of element.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
        if (candidate.getAttribute("tabindex") !== "-1" && !candidate.closest(".panel-header")) {
          return candidate;
        }
      }
      return null;
    }

    function getLastTabbable() {
      const all = Array.from(element.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR))
        .filter(candidate => candidate.getAttribute("tabindex") !== "-1");
      return all[all.length - 1] ?? null;
    }

    // Clear stale focus state from a previous panel session so focus always
    // starts fresh on the first dropdown.
    for (const elDropdown of element.querySelectorAll("tp-yt-paper-dropdown-menu")) {
      elDropdown.removeAttribute("keyboard-focused");
      elDropdown.removeAttribute("focused");
      elDropdown.querySelector("tp-yt-paper-menu-button")?.removeAttribute("focused");
      elDropdown.querySelector("tp-yt-paper-input")?.removeAttribute("focused");
    }

    const elInitialFocus = element.querySelector<HTMLElement>("tp-yt-paper-input:not([disabled])") ?? getFirstTabbable();
    elInitialFocus?.focus();

    // The panel always opens via keyboard (Enter on chevron), so the initial
    // focus is keyboard-initiated. Set the attribute directly because Polymer's
    // receivedFocusFromKeyboard may not be initialized yet at mount time.
    elInitialFocus?.closest("tp-yt-paper-dropdown-menu")?.setAttribute("keyboard-focused", "");

    let isShiftTab = false;
    function onKeydown(e: KeyboardEvent) {
      isShiftTab = e.key === "Tab" && e.shiftKey;
    }
    document.addEventListener("keydown", onKeydown, true);

    // Polymer's IronFocusedBehavior doesn't always clear the focused attribute
    // from sibling dropdowns when Tab moves between them. Explicitly clear stale
    // focused state so only the active dropdown shows the focus ring.
    function clearStaleFocus() {
      for (const elDropdown of element.querySelectorAll("tp-yt-paper-dropdown-menu[focused]")) {
        if (elDropdown.contains(document.activeElement)) {
          continue;
        }

        elDropdown.removeAttribute("focused");
        elDropdown.querySelector("tp-yt-paper-menu-button")?.removeAttribute("focused");
        elDropdown.querySelector("tp-yt-paper-input")?.removeAttribute("focused");
      }
    }

    // Focus trap: document-level focusin catches Tab even when Polymer stops
    // keydown propagation inside yt-button-view-model.
    // Also clears stale Polymer focused state from sibling dropdowns.
    function onFocusIn(e: FocusEvent) {
      const target = e.target;
      if (!(target instanceof Node)) {
        return;
      }

      clearStaleFocus();

      if (element.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest("tp-yt-iron-dropdown[data-ytdl-moved]") !== null) {
        return;
      }

      if (isShiftTab) {
        getLastTabbable()?.focus();
      } else {
        getFirstTabbable()?.focus();
      }
    }

    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeydown, true);
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
      {extension}
      {filename}
      {isDownloading}
      onaudioformatchange={format => (selectedAudioFormat = format)}
      ondownloadtypechange={handleDownloadTypeChange}
      onextensionchange={newExtension => (extension = newExtension)}
      onfilenamechange={newFilename => (filename = newFilename)}
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
            {Math.round(displayProgress)}% - {progressType === "ffmpeg" ? "Processing" : "Downloading"}
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
    padding: 20px 24px 16px;
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
    padding: 16px 24px 20px;
    min-height: 52px;
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
