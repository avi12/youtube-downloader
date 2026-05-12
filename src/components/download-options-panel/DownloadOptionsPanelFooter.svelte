<script lang="ts">
  import {
    attachPanelProgress,
    attachPanelProgressDone,
    attachPanelProgressFailed,
    attachPrimaryButton,
    attachViewButton,
    PrimaryButtonState
  } from "@/lib/ui/panel-button-attachments.svelte";
  import { ProgressType } from "@/types";

  interface Props {
    primaryState: PrimaryButtonState;
    displayProgress: number;
    progressType: string;
    scopingClass: string;
    primaryButtonId: string;
    viewButtonId: string;
    getIsDownloadable: () => boolean;
    getIsFilenameValid: () => boolean;
  }

  const {
    primaryState,
    displayProgress,
    progressType,
    scopingClass,
    primaryButtonId,
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
  <yt-button-view-model
    class={primaryButtonClass}
    {@attach attachPrimaryBtn}
    data-ytdl-button-id={primaryButtonId}
    role="button"
    tabindex="0"
  ></yt-button-view-model>

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
    <div class="ytdl-progress-block done">
      <tp-yt-paper-progress
        class="ytdl-progress-track"
        {@attach attachPanelProgressDone}
        value={100}
      ></tp-yt-paper-progress>
      <div class="ytdl-done-row">
        <span class="ytdl-progress-label" role="status">Downloaded</span>
        <yt-button-view-model
          class={scopingClass}
          {@attach attachViewButton}
          data-ytdl-button-id={viewButtonId}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      </div>
    </div>
  {:else if primaryState === PrimaryButtonState.Failed}
    <div class="ytdl-progress-block failed">
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

  .ytdl-progress-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-block-start: 4px;
  }

  .ytdl-done-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .ytdl-progress-track {
    display: block;
    overflow: hidden;
    width: 100%;
    border-radius: 4px;
  }

  .ytdl-progress-label {
    color: var(--yt-spec-text-secondary, #606060);
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;

    :global(html[dark]) & {
      color: var(--yt-spec-text-secondary, #aaaaaa);
    }

    .ytdl-progress-block.done & {
      color: var(--yt-spec-text-success, #1e8e3e);
    }

    .ytdl-progress-block.failed & {
      color: var(--yt-spec-text-error, #d93025);
    }

    :global(html[dark]) .ytdl-progress-block.done & {
      color: var(--yt-spec-text-success, #6cd16c);
    }

    :global(html[dark]) .ytdl-progress-block.failed & {
      color: var(--yt-spec-text-error, #ff6b6b);
    }
  }
</style>
