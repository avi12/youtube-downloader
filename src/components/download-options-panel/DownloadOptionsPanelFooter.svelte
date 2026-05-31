<script lang="ts">
  import { createFooterState, PrimaryButtonState } from "./DownloadOptionsPanelFooter.svelte.ts";
  import { attachViewButton } from "@/lib/ui/panel-button-attachments.svelte";

  interface Props {
    primaryState: PrimaryButtonState;
    displayProgress: number;
    progressType: string;
    scopingClass: string;
    primaryButtonId: string;
    viewButtonId: string;
    getIsDownloadable: () => boolean;
    getIsFilenameValid: () => boolean;
    estimatedSizeLabel: string;
  }

  const {
    primaryState, displayProgress, progressType, scopingClass,
    primaryButtonId, viewButtonId, getIsDownloadable, getIsFilenameValid,
    estimatedSizeLabel
  }: Props = $props();

  const isDone = $derived(primaryState === PrimaryButtonState.Done);
  const isFailed = $derived(primaryState === PrimaryButtonState.Failed);
  const isActive = $derived(primaryState === PrimaryButtonState.Downloading || isDone || isFailed);

  const footer = createFooterState({
    get primaryState() {
      return primaryState;
    },
    get displayProgress() {
      return displayProgress;
    },
    get progressType() {
      return progressType;
    },
    get getIsDownloadable() {
      return getIsDownloadable;
    },
    get getIsFilenameValid() {
      return getIsFilenameValid;
    },
    get estimatedSizeLabel() {
      return estimatedSizeLabel;
    }
  });
</script>

<div class="ytdl-panel-footer">
  <div class="ytdl-primary-button-wrapper">
    <yt-button-view-model
      class={scopingClass}
      {@attach footer.attachPrimaryButton}
      data-ytdl-button-id={primaryButtonId}
      role="button"
      tabindex="0"
    ></yt-button-view-model>
  </div>

  <div
    style:visibility={isActive ? null : "hidden"}
    class="ytdl-progress-block"
    class:done={isDone}
    class:failed={isFailed}
  >
    <tp-yt-paper-progress
      class="ytdl-progress-track"
      indeterminate={!isDone && !isFailed && displayProgress === 0 || undefined}
      value={isDone ? 100 : Math.round(displayProgress) || (isFailed ? 100 : 0)}
    ></tp-yt-paper-progress>
    {#if isDone}
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
    {:else if isFailed}
      <span class="ytdl-progress-label" role="alert">Download failed</span>
    {:else}
      <span class="ytdl-progress-label" aria-live="polite">{footer.downloadingLabel}</span>
    {/if}
  </div>
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
    --paper-progress-active-color: var(--yt-sys-color-baseline--call-to-action, #065fd4);
    --paper-progress-container-color: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    --paper-progress-height: 4px;

    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-block-start: 4px;

    &.done {
      --paper-progress-active-color: var(--yt-sys-color-baseline--text-complete, #1e8e3e);
    }

    &.failed {
      --paper-progress-active-color: var(--yt-sys-color-baseline--text-error, #d93025);
    }
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
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;

    .ytdl-progress-block.done & {
      color: var(--yt-sys-color-baseline--text-complete, #1e8e3e);
    }

    .ytdl-progress-block.failed & {
      color: var(--yt-sys-color-baseline--text-error, #d93025);
    }
  }
</style>
