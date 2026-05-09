<script lang="ts">
  import DownloadOptions from "./DownloadOptions.svelte";
  import { createFocusManager } from "./DownloadOptionsPanel.focus.svelte";
  import { createPanelState } from "./DownloadOptionsPanel.state.svelte.ts";
  import { CrossWorldMessage, crossWorldMessenger, onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import {
    attachCloseButton,
    attachGhostButton,
    attachPanelProgress,
    attachPanelProgressDone,
    attachPanelProgressFailed,
    attachPrimaryButton,
    PrimaryButtonState
  } from "@/lib/ui/panel-button-attachments.svelte";
  import { ProgressType, type VideoData } from "@/types";

  const percentFormatter = new Intl.NumberFormat(document.documentElement.lang || undefined, {
    style: "percent",
    maximumFractionDigits: 0
  });

  const scopingClass =
    document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")?.getAttribute("class") ??
    "";

  type Props = {
    videoData: VideoData;
  };

  const props: Props = $props();

  const panel = createPanelState(() => props.videoData);
  const focusManager = createFocusManager();

  const closeButtonId = "ytdl-panel-close";
  const primaryButtonId = "ytdl-panel-primary";
  const discardButtonId = "ytdl-panel-discard";
  const viewButtonId = "ytdl-panel-view";

  const primaryState = $derived.by<PrimaryButtonState>(() => {
    if (panel.isDownloading) {
      return PrimaryButtonState.Downloading;
    }

    if (panel.isFailed) {
      return PrimaryButtonState.Failed;
    }

    if (panel.isInterrupted) {
      return PrimaryButtonState.Interrupted;
    }

    if (panel.isDone) {
      return PrimaryButtonState.Done;
    }

    return PrimaryButtonState.Idle;
  });

  function closePanel() {
    focusManager.release();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelClosed, {});
    document.dispatchEvent(new CustomEvent("ytdl:panel-closed"));
  }

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === closeButtonId) {
      closePanel();
    } else if (buttonId === primaryButtonId) {
      if (primaryState === PrimaryButtonState.Downloading) {
        void panel.cancelDownload();
      } else if (primaryState === PrimaryButtonState.Interrupted) {
        panel.resumeDownload();
      } else {
        panel.startDownload();
      }
    } else if (buttonId === discardButtonId) {
      void panel.discardInterrupted();
    } else if (buttonId === viewButtonId) {
      panel.revealDownload();
    }
  }));

  function attachPrimaryBtn(elButton: Element) {
    attachPrimaryButton({
      elButton,
      getState: () => primaryState,
      getIsDownloadable: () => panel.isDownloadable,
      getIsFilenameValid: () => panel.isFilenameValid
    });
  }
</script>

<div
  class="ytdl-panel"
  {@attach focusManager.attach}
  aria-labelledby="ytdl-panel-title"
  aria-modal="true"
  onkeydown={e => {
    if (e.key === "Escape") {
      closePanel();
    }

    // YouTube's video player listens for global Space (play/pause) and arrow
    // keys (seek/volume). Stop these from bubbling out of the panel so they
    // only act on the focused control inside.
    if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown"
      || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.stopPropagation();
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
    <div class="ytdl-footer-buttons">
      {#if primaryState === PrimaryButtonState.Interrupted}
        <yt-button-view-model
          class={scopingClass}
          {@attach attachGhostButton("Discard")}
          data-ytdl-button-id={discardButtonId}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      {/if}
      {#if primaryState === PrimaryButtonState.Done && panel.downloadId !== null}
        <yt-button-view-model
          class={scopingClass}
          {@attach attachGhostButton("View")}
          data-ytdl-button-id={viewButtonId}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      {/if}
      <yt-button-view-model
        class="{scopingClass} {primaryState === PrimaryButtonState.Downloading ? "ytdl-cancel-state" : ""}"
        {@attach attachPrimaryBtn}
        data-ytdl-button-id={primaryButtonId}
        role="button"
        tabindex="0"
      ></yt-button-view-model>
    </div>

    {#if primaryState === PrimaryButtonState.Downloading}
      <div class="ytdl-progress-block">
        <tp-yt-paper-progress
          class="ytdl-progress-track"
          {@attach attachPanelProgress}
          indeterminate={panel.displayProgress === 0 || undefined}
          value={Math.round(panel.displayProgress)}
        ></tp-yt-paper-progress>
        <span class="ytdl-progress-label" aria-live="polite">
          {`${percentFormatter.format(panel.displayProgress / 100)} - ${panel.progressType === ProgressType.FFmpeg ? "Processing" : "Downloading"}`}
        </span>
      </div>
    {:else if primaryState === PrimaryButtonState.Done}
      <div class="ytdl-progress-block ytdl-progress-block--done">
        <tp-yt-paper-progress
          class="ytdl-progress-track"
          {@attach attachPanelProgressDone}
          value={100}
        ></tp-yt-paper-progress>
        <span class="ytdl-progress-label" role="status">Downloaded</span>
      </div>
    {:else if primaryState === PrimaryButtonState.Failed}
      <div class="ytdl-progress-block ytdl-progress-block--failed">
        <tp-yt-paper-progress
          class="ytdl-progress-track"
          {@attach attachPanelProgressFailed}
          value={Math.round(panel.displayProgress) || 100}
        ></tp-yt-paper-progress>
        <span class="ytdl-progress-label" role="alert">Download failed</span>
      </div>
    {/if}
  </div>
</div>

<style>
  /* YouTube doesn't expose --yt-spec-text-primary at the document root or via
     any reachable Polymer scope, so define it ourselves keyed on the [dark]
     attribute YouTube already toggles. Other rules can then use the spec name. */
  .ytdl-panel {
    --yt-spec-text-primary: rgb(15 15 15);
    --yt-spec-text-secondary: rgb(96 96 96);
    --ytdl-border: rgb(0 0 0 / 9%);
    --ytdl-border-strong: rgb(0 0 0 / 16%);
    --ytdl-bg-elev-2: rgb(255 255 255);
    --ytdl-bg-hover: rgb(0 0 0 / 6%);
    --ytdl-cta: #065fd4;
    --ytdl-danger: #d93025;
    --ytdl-success: #1e8e3e;
    --ytdl-primary-bg: #0f0f0f;
    --ytdl-primary-text: #ffffff;

    width: 380px;
    border: 1px solid var(--ytdl-border);
    border-radius: 12px;
    background: var(--ytdl-bg-elev-2);
    color: var(--yt-spec-text-primary);
    box-shadow: 0 8px 32px rgb(0 0 0 / 32%), 0 2px 8px rgb(0 0 0 / 16%);
  }

  :global(html[dark]) .ytdl-panel {
    --yt-spec-text-primary: rgb(241 241 241);
    --yt-spec-text-secondary: rgb(170 170 170);
    --ytdl-border: rgb(255 255 255 / 12%);
    --ytdl-border-strong: rgb(255 255 255 / 20%);
    --ytdl-bg-elev-2: rgb(39 39 39);
    --ytdl-bg-hover: rgb(255 255 255 / 8%);
    --ytdl-cta: #3ea6ff;
    --ytdl-danger: #ff6b6b;
    --ytdl-success: #6cd16c;
    --ytdl-primary-bg: #f1f1f1;
    --ytdl-primary-text: #0f0f0f;
  }

  /* YouTube's focus CSS sets background:unset on .ytSpecButtonShapeNextMono.ytSpecButtonShapeNextFocused,
     which strips the fill from the Download/Download-again button when Tab-focused.
     Restore it by re-applying the same Polymer CSS variables at higher specificity. */
  .ytdl-panel :global(.ytSpecButtonShapeNextMono.ytSpecButtonShapeNextFilled.ytSpecButtonShapeNextFocused) {
    border-color: transparent;
    background: var(--tffc2fd3a644f6275);
    color: var(--t6216186c28b3834b);
  }

  /* Focus ring for keyboard navigation. YouTube removes outlines globally; restore them
     inside the panel so keyboard users can see which button is focused. */
  .ytdl-panel :global(button:focus-visible) {
    outline: 2px solid var(--yt-spec-call-to-action, var(--ytdl-cta)) !important;
    outline-offset: 3px;
  }

  /* Cancel state mirrors the design's .dl-btn-danger: red text + red border,
     transparent bg, subtle red tint on hover. */
  .ytdl-panel :global(.ytdl-cancel-state button) {
    border-color: var(--yt-spec-text-error, var(--ytdl-danger)) !important;
    background: transparent !important;
    color: var(--yt-spec-text-error, var(--ytdl-danger)) !important;
  }

  .ytdl-panel :global(.ytdl-cancel-state button:hover) {
    background: color-mix(in oklab, var(--yt-spec-text-error, var(--ytdl-danger)) 12%, transparent) !important;
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
    color: var(--yt-spec-text-primary);
    font-weight: 500;
    font-size: 1.6rem;
    line-height: 1.375;
  }

  .ytdl-panel-body {
    padding: 0 24px;
  }

  .ytdl-panel-footer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-block: 16px 20px;
    padding-inline: 24px;
  }

  .ytdl-progress-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-block-start: 4px;
  }

  .ytdl-progress-track {
    display: block;
    overflow: hidden;
    width: 100%;
    border-radius: 4px;
  }

  .ytdl-progress-label {
    color: var(--yt-spec-text-secondary);
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;
  }

  .ytdl-progress-block--done .ytdl-progress-label {
    color: var(--yt-spec-text-success, var(--ytdl-success));
  }

  .ytdl-progress-block--failed .ytdl-progress-label {
    color: var(--yt-spec-text-error, var(--ytdl-danger));
  }

  .ytdl-footer-buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    align-items: center;
  }

  .ytdl-done-status {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--yt-spec-call-to-action, var(--ytdl-cta));
    font-size: 1.3rem;
  }
</style>
