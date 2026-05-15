<script lang="ts">
  import DownloadOptions from "./DownloadOptions.svelte";
  import { createFocusManager } from "./DownloadOptionsPanel.focus.svelte";
  import { createPanelState } from "./DownloadOptionsPanel.state.svelte.ts";
  import {
    handlePanelKeydown,
    HEADER_CLOSE_BUTTON_ID,
    PRIMARY_BUTTON_ID,
    sendPanelClosed,
    setupPanelButtonHandler,
    VIEW_BUTTON_ID
  } from "./DownloadOptionsPanel.svelte.ts";
  import DownloadOptionsPanelFooter from "./DownloadOptionsPanelFooter.svelte";
  import { attachCloseButton } from "@/lib/ui/panel-button-attachments.svelte";
  import type { VideoData } from "@/types";

  const scopingClass = document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")?.getAttribute("class") ?? "";

  interface Props {
    videoData: VideoData;
  }

  const props: Props = $props();

  const panel = createPanelState(() => props.videoData);
  const focusManager = createFocusManager();

  function closePanel() {
    focusManager.release();
    sendPanelClosed();
  }

  const onPanelKeydown = handlePanelKeydown(closePanel);

  $effect(() => setupPanelButtonHandler({
    panel,
    onClose: closePanel
  }));
</script>

<div
  class="ytdl-panel"
  {@attach focusManager.attach}
  aria-labelledby="ytdl-panel-title"
  aria-modal="true"
  onkeydown={onPanelKeydown}
  role="dialog"
  tabindex="-1"
>
  <div class="ytdl-panel-header">
    <h2 id="ytdl-panel-title" class="ytdl-panel-title">Download options</h2>
    <yt-button-view-model
      class={scopingClass}
      {@attach attachCloseButton}
      aria-label="Close"
      data-ytdl-button-id={HEADER_CLOSE_BUTTON_ID}
      role="button"
      tabindex="0"
    ></yt-button-view-model>
  </div>

  <div class="ytdl-panel-body">
    <DownloadOptions
      audioFormats={props.videoData.audioFormats}
      captionTracks={props.videoData.captionTracks}
      downloadExtras={panel.downloadExtras}
      downloadType={panel.downloadType}
      extension={panel.actualExtension}
      filename={panel.filename}
      isDownloading={panel.isDownloading}
      onaudiocustomchange={panel.audio.handlePanelAudioCustomChange}
      onaudioformatchange={format => (panel.selectedAudioFormat = format)}
      onaudiomodechange={panel.audio.handlePanelAudioModeChange}
      oncaptionchange={panel.caption.handleCaptionChange}
      oncaptionmodechange={panel.caption.handlePanelCaptionModeChange}
      ondownloadtypechange={panel.handleDownloadTypeChange}
      onextensionchange={newExtension => (panel.extension = newExtension)}
      onfilenamechange={newFilename => (panel.filename = newFilename)}
      onvalidationchange={isValid => (panel.isFilenameValid = isValid)}
      onvideoformatchange={format => (panel.selectedVideoFormat = format)}
      panelAudioCustomLanguage={panel.audio.panelAudioCustomLanguage}
      panelAudioMode={panel.audio.panelAudioMode}
      panelCaptionMode={panel.caption.panelCaptionMode}
      selectedAudioFormat={panel.selectedAudioFormat}
      selectedCaptionTrack={panel.caption.selectedCaptionTrack}
      selectedVideoFormat={panel.selectedVideoFormat}
      videoFormats={props.videoData.videoFormats}
    />
  </div>

  <DownloadOptionsPanelFooter
    displayProgress={panel.displayProgress}
    getIsDownloadable={() => panel.isDownloadable}
    getIsFilenameValid={() => panel.isFilenameValid}
    primaryButtonId={PRIMARY_BUTTON_ID}
    primaryState={panel.primaryState}
    progressType={panel.progressType}
    {scopingClass}
    viewButtonId={VIEW_BUTTON_ID}
  />
</div>

<style>
  :global([id^="ytdl-grid-panel-"]) {
    overflow: visible !important;
  }

  .ytdl-panel {
    display: flex;
    flex-direction: column;
    width: 420px;
    max-height: inherit;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    border-radius: 12px;
    background: var(--yt-sys-color-baseline--raised-background, var(--yt-sys-color-baseline--base-background, #ffffff));
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    box-shadow: 0 4px 24px var(--yt-sys-color-baseline--shadow-medium, rgb(0 0 0 / 25%));

    &:focus {
      outline: none;
    }

    & :global(.ytSpecButtonShapeNextMono.ytSpecButtonShapeNextFilled.ytSpecButtonShapeNextFocused) {
      border-color: transparent;
      background: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
      color: var(--yt-sys-color-baseline--base-background, #ffffff);
    }

    & :global(button:focus-visible) {
      outline: 2px solid var(--yt-sys-color-baseline--call-to-action, #065fd4);
      outline-offset: 3px;
    }

    & :global(.ytdl-cancel-state button) {
      border-color: var(--yt-sys-color-baseline--text-error, #d93025);
      background: transparent;
      color: var(--yt-sys-color-baseline--text-error, #d93025);
    }

    & :global(.ytdl-cancel-state button:hover) {
      background: color-mix(in oklab, var(--yt-sys-color-baseline--text-error, #d93025) 12%, transparent);
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
    font-weight: 600;
    font-size: 1.6rem;
    line-height: 1.375;
  }

  .ytdl-panel-body {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 0 24px;
  }
</style>
