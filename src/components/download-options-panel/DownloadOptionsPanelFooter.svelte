<script lang="ts">
  import {
    attachGhostButton,
    attachPanelProgress,
    attachPanelProgressDone,
    attachPanelProgressFailed,
    attachPrimaryButton,
    PrimaryButtonState
  } from "@/lib/ui/panel-button-attachments.svelte";
  import { ProgressType } from "@/types";

  interface Props {
    primaryState: PrimaryButtonState;
    displayProgress: number;
    progressType: string;
    downloadId: number | null;
    scopingClass: string;
    primaryButtonId: string;
    discardButtonId: string;
    viewButtonId: string;
    getIsDownloadable: () => boolean;
    getIsFilenameValid: () => boolean;
  }

  const {
    primaryState,
    displayProgress,
    progressType,
    downloadId,
    scopingClass,
    primaryButtonId,
    discardButtonId,
    viewButtonId,
    getIsDownloadable,
    getIsFilenameValid
  }: Props = $props();

  const percentFormatter = new Intl.NumberFormat(document.documentElement.lang || undefined, {
    style: "percent",
    maximumFractionDigits: 0
  });

  const downloadingLabel = $derived.by(() => {
    if (displayProgress === 0) {
      return "Preparing";
    }

    const formattedPercentage = percentFormatter.format(displayProgress / 100);
    if (progressType === ProgressType.FFmpeg) {
      return `${formattedPercentage} - Processing`;
    }

    return `${formattedPercentage} - Downloading`;
  });

  const primaryButtonClass = $derived(
    `${scopingClass} ${primaryState === PrimaryButtonState.Downloading ? "ytdl-cancel-state" : ""}`
  );

  function attachPrimaryBtn(elButton: Element) {
    attachPrimaryButton({
      elButton,
      getState: () => primaryState,
      getIsDownloadable,
      getIsFilenameValid
    });
  }
</script>

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
    {#if primaryState === PrimaryButtonState.Done && downloadId !== null}
      <yt-button-view-model
        class={scopingClass}
        {@attach attachGhostButton("View")}
        data-ytdl-button-id={viewButtonId}
        role="button"
        tabindex="0"
      ></yt-button-view-model>
    {/if}
    <yt-button-view-model
      class={primaryButtonClass}
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
        indeterminate={displayProgress === 0 || undefined}
        value={Math.round(displayProgress)}
      ></tp-yt-paper-progress>
      <span class="ytdl-progress-label" aria-live="polite">
        {downloadingLabel}
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
        value={Math.round(displayProgress) || 100}
      ></tp-yt-paper-progress>
      <span class="ytdl-progress-label" role="alert">Download failed</span>
    </div>
  {/if}
</div>

<style>
  .ytdl-panel-footer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-block: 16px 20px;
    padding-inline: 24px;
  }

  .ytdl-footer-buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    align-items: center;
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
</style>
