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
    width: 380px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
    border-radius: 12px;
    background: var(--yt-spec-raised-background, var(--yt-spec-base-background, #ffffff));
    color: var(--yt-spec-text-primary, #0f0f0f);
    box-shadow: 0 8px 32px rgb(0 0 0 / 32%), 0 2px 8px rgb(0 0 0 / 16%);

    &:focus {
      outline: none;
    }

    :global(html[dark]) & {
      border-color: var(--yt-spec-10-percent-layer, rgb(255 255 255 / 10%));
      background: var(--yt-spec-raised-background, #212121);
      color: var(--yt-spec-text-primary, #f1f1f1);
    }

    & :global(.ytSpecButtonShapeNextMono.ytSpecButtonShapeNextFilled.ytSpecButtonShapeNextFocused) {
      border-color: transparent;
      background: var(--yt-spec-text-primary, #0f0f0f);
      color: var(--yt-spec-base-background, #ffffff);
    }

    & :global(button:focus-visible) {
      outline: 2px solid var(--yt-spec-call-to-action, #065fd4);
      outline-offset: 3px;

      :global(html[dark]) & {
        outline-color: var(--yt-spec-call-to-action, #3ea6ff);
      }
    }

    & :global(.ytdl-cancel-state button) {
      border-color: var(--yt-spec-text-error, #d93025);
      background: transparent;
      color: var(--yt-spec-text-error, #d93025);

      :global(html[dark]) & {
        border-color: var(--yt-spec-text-error, #ff6b6b);
        color: var(--yt-spec-text-error, #ff6b6b);
      }
    }

    & :global(.ytdl-cancel-state button:hover) {
      background: color-mix(in oklab, var(--yt-spec-text-error, #d93025) 12%, transparent);

      :global(html[dark]) & {
        background: color-mix(in oklab, var(--yt-spec-text-error, #ff6b6b) 12%, transparent);
      }
    }
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
    font-weight: 500;
    font-size: 1.6rem;
    line-height: 1.375;
  }

  .ytdl-panel-body {
    padding: 0 24px;
  }
</style>
