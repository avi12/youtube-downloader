<script lang="ts">
  import type { createPlaylistGridItemState } from "./PlaylistGridItem.state.svelte";
  import {
    createFooterState,
    PrimaryButtonState
  } from "@/components/download-options-panel/DownloadOptionsPanelFooter.svelte.ts";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { attachViewButton } from "@/lib/ui/panel-button-attachments.svelte";

  interface Props {
    playlistId: string;
    state: ReturnType<typeof createPlaylistGridItemState>;
    scopingClass: string;
  }

  const { playlistId, state, scopingClass }: Props = $props();

  const primaryButtonId = $derived(`ytdl-grid-panel-primary-${playlistId}`);
  const viewButtonId = $derived(`ytdl-grid-panel-view-${playlistId}`);

  const isDone = $derived(state.primaryState === PrimaryButtonState.Done);
  const isFailed = $derived(state.primaryState === PrimaryButtonState.Failed);
  const isActive = $derived(state.primaryState === PrimaryButtonState.Downloading || isDone || isFailed);
  const isViewButtonVisible = $derived(isDone && state.completedDownloadId !== null);

  const footer = createFooterState({
    get primaryState() {
      return state.primaryState;
    },
    get displayProgress() {
      return state.displayProgress;
    },
    get progressType() {
      return state.progressType;
    },
    get getIsDownloadable() {
      return () => state.isReadyToDownload;
    },
    get getIsFilenameValid() {
      return () => true;
    },
    get estimatedSizeLabel() {
      return state.estimatedSizeLabel;
    }
  });

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === primaryButtonId) {
      state.handlePrimaryClick();
      return;
    }

    if (buttonId === viewButtonId) {
      state.revealDownload();
    }
  }));
</script>

<div class="ytdl-panel-footer">
  <yt-button-view-model
    class={scopingClass}
    {@attach footer.attachPrimaryButton}
    data-ytdl-button-id={primaryButtonId}
    role="button"
    tabindex="0"
  ></yt-button-view-model>

  {#if isActive}
    <div class="ytdl-progress-block" class:done={isDone} class:failed={isFailed}>
      <tp-yt-paper-progress
        class="ytdl-progress-track"
        indeterminate={!isDone && !isFailed && state.displayProgress === 0 || undefined}
        value={isDone ? 100 : Math.round(state.displayProgress) || (isFailed ? 100 : 0)}
      ></tp-yt-paper-progress>
      {#if isDone}
        <div class="ytdl-done-row">
          <span class="ytdl-progress-label" role="status">Downloaded</span>
          {#if isViewButtonVisible}
            <yt-button-view-model
              class={scopingClass}
              {@attach attachViewButton}
              data-ytdl-button-id={viewButtonId}
              role="button"
              tabindex="0"
            ></yt-button-view-model>
          {/if}
        </div>
      {:else if isFailed}
        <span class="ytdl-progress-label" role="alert">Download failed</span>
      {:else}
        <span class="ytdl-progress-label" aria-live="polite">{footer.downloadingLabel}</span>
      {/if}
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
