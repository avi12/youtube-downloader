<script lang="ts">
  import DownloadOptions from "./DownloadOptions.svelte";
  import { createFocusManager } from "./DownloadOptionsPanel.focus.svelte";
  import { createPanelState } from "./DownloadOptionsPanel.state.svelte.ts";
  import { CrossWorldMessage, crossWorldMessenger, onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import {
    attachCancelButton,
    attachCloseButton,
    attachDoneIcon,
    attachDownloadButton,
    attachGhostButton,
    attachPanelProgress,
    attachResumeButton
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
  const closeFooterButtonId = "ytdl-panel-close-footer";
  const downloadButtonId = "ytdl-panel-download";
  const cancelButtonId = "ytdl-panel-cancel";
  const hideButtonId = "ytdl-panel-hide";
  const resumeButtonId = "ytdl-panel-resume";
  const discardButtonId = "ytdl-panel-discard";

  function closePanel() {
    focusManager.release();
    void crossWorldMessenger.sendMessage(CrossWorldMessage.PanelClosed, {});
    document.dispatchEvent(new CustomEvent("ytdl:panel-closed"));
  }

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === closeButtonId || buttonId === closeFooterButtonId || buttonId === hideButtonId) {
      closePanel();
    } else if (buttonId === downloadButtonId) {
      panel.startDownload();
    } else if (buttonId === cancelButtonId) {
      void panel.cancelDownload();
    } else if (buttonId === resumeButtonId) {
      panel.resumeDownload();
    } else if (buttonId === discardButtonId) {
      void panel.discardInterrupted();
    }
  }));

  function handleActivationKeydown(callback: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        callback();
      }
    };
  }

  function attachDownloadBtn(elButton: Element) {
    attachDownloadButton({
      elButton,
      getIsDownloadable: () => panel.isDownloadable,
      getIsFilenameValid: () => panel.isFilenameValid,
      getIsDone: () => panel.isDone
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
        <span class="ytdl-progress-label" aria-live="polite">
          {percentFormatter.format(panel.displayProgress / 100)} - {panel.progressType === ProgressType.FFmpeg ? "Processing" : "Downloading"}
        </span>
      </div>
      <div class="ytdl-footer-buttons">
        <yt-button-view-model
          class={scopingClass}
          {@attach attachGhostButton("Hide")}
          data-ytdl-button-id={hideButtonId}
          onkeydown={handleActivationKeydown(closePanel)}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
        <yt-button-view-model
          class={scopingClass}
          {@attach attachCancelButton}
          data-ytdl-button-id={cancelButtonId}
          onkeydown={handleActivationKeydown(panel.cancelDownload)}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      </div>
    {:else if panel.isInterrupted}
      <div class="ytdl-footer-buttons">
        <yt-button-view-model
          class={scopingClass}
          {@attach attachGhostButton("Discard")}
          data-ytdl-button-id={discardButtonId}
          onkeydown={handleActivationKeydown(panel.discardInterrupted)}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
        <yt-button-view-model
          class={scopingClass}
          {@attach attachResumeButton}
          data-ytdl-button-id={resumeButtonId}
          onkeydown={handleActivationKeydown(panel.resumeDownload)}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      </div>
    {:else}
      {#if panel.isDone}
        <div class="ytdl-done-status" role="status">
          <yt-button-view-model
            class={scopingClass}
            {@attach attachDoneIcon}
          ></yt-button-view-model>
          <span>Downloaded</span>
        </div>
      {/if}
      <div class="ytdl-footer-buttons">
        <yt-button-view-model
          class={scopingClass}
          {@attach attachGhostButton("Close")}
          data-ytdl-button-id={closeFooterButtonId}
          onkeydown={handleActivationKeydown(closePanel)}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
        <yt-button-view-model
          class={scopingClass}
          {@attach attachDownloadBtn}
          data-ytdl-button-id={downloadButtonId}
          onkeydown={handleActivationKeydown(panel.startDownload)}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      </div>
    {/if}
  </div>
</div>

<style>
  .ytdl-panel {
    overflow: hidden;
    width: 380px;
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
    /* light-dark() flips with the document's color-scheme - YouTube sets that
       per active theme, so no [dark] selector needed. yt-spec-text-primary is
       preferred when defined; the literal pair matches YouTube's actual values. */
    color: var(--yt-spec-text-primary, light-dark(rgb(15 15 15), rgba(255 255 255 / 88%)));
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

  .ytdl-progress-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ytdl-progress-label {
    font-size: 1.3rem;
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
    color: var(--yt-spec-call-to-action, #3ea6ff);
    font-size: 1.3rem;
  }
</style>
