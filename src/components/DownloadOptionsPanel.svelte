<script lang="ts">
  import DownloadOptions from "./DownloadOptions.svelte";
  import { createPanelState } from "./DownloadOptionsPanel.state.svelte.ts";
  import panelFocusStyles from "./panel-focus.css?inline";
  import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
  import { applyInertTrap } from "@/lib/inert-trap";
  import {
    attachCancelButton,
    attachCloseButton,
    attachDoneIcon,
    attachDownloadButton,
    attachPanelProgress
  } from "@/lib/panel-button-attachments.svelte";
  import { buttonClickSignal } from "@/lib/synced-stores.svelte";
  import { ProgressType, type Options, type VideoData } from "@/types";

  const percentFormatter = new Intl.NumberFormat(document.documentElement.lang || undefined, {
    style: "percent",
    maximumFractionDigits: 0
  });

  // Grab Polymer's scoping class from an existing action-bar button so that
  // yt-button-view-model elements in this panel receive identical styling.
  const scopingClass =
    document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")?.getAttribute("class") ??
    "";

  type Props = {
    videoData: VideoData;
    options: Options;
  };

  const props: Props = $props();

  const panel = createPanelState(() => props.videoData, () => props.options);

  // -- Inert focus trap -------------------------------------------------------

  let removeInert: (() => void) | null = null;

  function releaseInertTrap() {
    removeInert?.();
    removeInert = null;
  }

  // -- Actions ----------------------------------------------------------------

  const closeButtonId = "ytdl-panel-close";
  const downloadButtonId = "ytdl-panel-download";
  const cancelButtonId = "ytdl-panel-cancel";

  function closePanel() {
    releaseInertTrap();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelClosed, {});
    // Also dispatch DOM event for grid/playlist panels where crossWorldMessenger
    // panelClosed listener is owned by the watch page
    document.dispatchEvent(new CustomEvent("ytdl:panel-closed"));
  }

  // yt-button-view-model doesn't fire Svelte's onclick when the user clicks
  // the inner Polymer-rendered <button>. Route every panel button through the
  // MAIN-world buttonClickSignal bus.
  $effect(() => {
    const clicked = buttonClickSignal.value;
    if (!clicked?.buttonId) {
      return;
    }

    if (clicked.buttonId === closeButtonId) {
      closePanel();
    } else if (clicked.buttonId === downloadButtonId) {
      panel.startDownload();
    } else if (clicked.buttonId === cancelButtonId) {
      void panel.cancelDownload();
    }
  });

  function handleActivationKeydown(callback: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        callback();
      }
    };
  }

  // -- Polymer button attaches ------------------------------------------------

  function attachDownloadBtn(elButton: Element) {
    attachDownloadButton(elButton, () => panel.isDownloadable, () => panel.isFilenameValid, () => panel.isDone);
  }

  // -- Focus management -------------------------------------------------------

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

<div
  class="ytdl-panel"
  {@attach attachPanel}
  aria-labelledby="ytdl-panel-title"
  aria-modal="true"
  onkeydown={e => {
    if (e.key === "Escape") {
      closePanel();
    }
  }}
  role="dialog"
  tabindex="-1"
>
  <div class="ytdl-panel-header">
    <h2 id="ytdl-panel-title" class="ytdl-panel-title">Download options</h2>
    <yt-button-view-model
      class={scopingClass}
      {@attach attachCloseButton}
      aria-label="Close"
      data-ytdl-button-id={closeButtonId}
      onkeydown={handleActivationKeydown(closePanel)}
      role="button"
      tabindex="0"
    ></yt-button-view-model>
  </div>

  <div class="ytdl-panel-body">
    <DownloadOptions
      audioFormats={props.videoData.audioFormats}
      downloadType={panel.downloadType}
      extension={panel.actualExtension}
      filename={panel.filename}
      isDownloading={panel.isDownloading}
      onaudioformatchange={format => (panel.selectedAudioFormat = format)}
      ondownloadtypechange={panel.handleDownloadTypeChange}
      onextensionchange={newExtension => (panel.extension = newExtension)}
      onfilenamechange={newFilename => (panel.filename = newFilename)}
      onvalidationchange={isValid => (panel.isFilenameValid = isValid)}
      onvideoformatchange={format => (panel.selectedVideoFormat = format)}
      selectedAudioFormat={panel.selectedAudioFormat}
      selectedVideoFormat={panel.selectedVideoFormat}
      videoFormats={props.videoData.videoFormats}
    />
  </div>

  <div class="ytdl-panel-footer">
    {#if panel.isDownloading}
      <div class="ytdl-progress-section">
        <tp-yt-paper-progress
          {@attach attachPanelProgress}
          value={Math.round(panel.displayProgress)}
        ></tp-yt-paper-progress>
        <div class="ytdl-progress-row">
          <span class="ytdl-progress-label" aria-live="polite">
            {percentFormatter.format(panel.displayProgress / 100)} - {panel.progressType === ProgressType.FFmpeg ? "Processing" : "Downloading"}
          </span>
          <yt-button-view-model
            class={scopingClass}
            {@attach attachCancelButton}
            data-ytdl-button-id="ytdl-panel-cancel"
            onclick={panel.cancelDownload}
            onkeydown={handleActivationKeydown(panel.cancelDownload)}
            role="button"
            tabindex="0"
          ></yt-button-view-model>
        </div>
      </div>
    {:else}
      {#if panel.isDone}
        <div class="ytdl-done-row">
          <div class="ytdl-done-status" role="status">
            <yt-button-view-model
              class={scopingClass}
              {@attach attachDoneIcon}
            ></yt-button-view-model>
            <span>Downloaded</span>
          </div>
          <yt-button-view-model
            class={scopingClass}
            {@attach attachDownloadBtn}
            data-ytdl-button-id="ytdl-panel-download"
            onclick={panel.startDownload}
            onkeydown={handleActivationKeydown(panel.startDownload)}
            role="button"
            tabindex="0"
          ></yt-button-view-model>
        </div>
      {:else}
        <yt-button-view-model
          class={scopingClass}
          {@attach attachDownloadBtn}
          data-ytdl-button-id="ytdl-panel-download"
          onclick={panel.startDownload}
          onkeydown={handleActivationKeydown(panel.startDownload)}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      {/if}
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

  .ytdl-done-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .ytdl-done-status {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--yt-spec-call-to-action, #3ea6ff);
    font-size: 1.3rem;
  }
</style>
