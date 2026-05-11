<script lang="ts">
  import DownloadOptions from "./DownloadOptions.svelte";
  import { createFocusManager } from "./DownloadOptionsPanel.focus.svelte";
  import { createPanelState } from "./DownloadOptionsPanel.state.svelte.ts";
  import DownloadOptionsPanelFooter from "./DownloadOptionsPanelFooter.svelte";
  import { CrossWorldMessage, crossWorldMessenger, onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { attachCloseButton, PrimaryButtonState } from "@/lib/ui/panel-button-attachments.svelte";
  import type { VideoData } from "@/types";

  const scopingClass =
    document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")?.getAttribute("class") ??
    "";

  interface Props {
    videoData: VideoData;
  }

  const props: Props = $props();

  const panel = createPanelState(() => props.videoData);
  const focusManager = createFocusManager();

  const closeButtonId = "ytdl-panel-close";
  const primaryButtonId = "ytdl-panel-primary";
  const discardButtonId = "ytdl-panel-discard";
  const viewButtonId = "ytdl-panel-view";

  function closePanel() {
    focusManager.release();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelClosed, {});
    document.dispatchEvent(new CustomEvent("ytdl:panel-closed"));
  }

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === closeButtonId) {
      closePanel();
      return;
    }

    if (buttonId === primaryButtonId) {
      if (panel.primaryState === PrimaryButtonState.Downloading) {
        void panel.cancelDownload();
      } else if (panel.primaryState === PrimaryButtonState.Interrupted) {
        panel.resumeDownload();
      } else {
        panel.startDownload();
      }

      return;
    }

    if (buttonId === discardButtonId) {
      void panel.discardInterrupted();
      return;
    }

    if (buttonId === viewButtonId) {
      panel.revealDownload();
    }
  }));
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

    const isYouTubePlayerKey = e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown"
      || e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (isYouTubePlayerKey) {
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

  <DownloadOptionsPanelFooter
    {discardButtonId}
    displayProgress={panel.displayProgress}
    downloadId={panel.downloadId}
    getIsDownloadable={() => panel.isDownloadable}
    getIsFilenameValid={() => panel.isFilenameValid}
    {primaryButtonId}
    primaryState={panel.primaryState}
    progressType={panel.progressType}
    {scopingClass}
    {viewButtonId}
  />
</div>

<style>
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
    --ytdl-progress-track: rgb(0 0 0 / 10%);

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
    --ytdl-progress-track: rgb(255 255 255 / 10%);
  }

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
</style>
