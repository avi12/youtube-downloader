<script lang="ts">
  import { CrossWorldMessage, crossWorldMessenger, onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import {
    attachCloseButton,
    attachDoneIcon,
    attachGhostButton,
    attachResumeButton
  } from "@/lib/ui/panel-button-attachments.svelte";
  import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
  import type { VideoData } from "@/types";

  type Props = { videoData: VideoData };
  const { videoData }: Props = $props();

  const progressState = $derived(downloadProgressStore.get(videoData.videoId));
  const interruptedState = $derived(interruptedDownloadStore.get(videoData.videoId));

  const isDone = $derived(progressState?.isDone === true);
  const isFailed = $derived(progressState?.isFailed === true);
  const isInterrupted = $derived(!!interruptedState);

  let dismissed = $state(false);
  let prevTrigger = $state("");

  $effect(() => {
    let trigger = "none";
    if (isDone) {
      trigger = "done";
    } else if (isFailed) {
      trigger = "failed";
    } else if (isInterrupted) {
      trigger = "interrupted";
    }

    if (trigger !== "none" && trigger !== prevTrigger) {
      dismissed = false;
    }

    prevTrigger = trigger;
  });

  const showToast = $derived((isDone || isFailed || isInterrupted) && !dismissed);

  const scopingClass =
    document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")?.getAttribute("class") ?? "";

  const dismissButtonId = $derived(`ytdl-toast-dismiss-${videoData.videoId}`);
  const retryButtonId = $derived(`ytdl-toast-retry-${videoData.videoId}`);
  const resumeButtonId = $derived(`ytdl-toast-resume-${videoData.videoId}`);

  function dismiss() {
    dismissed = true;
  }

  function retry() {
    downloadProgressStore.delete(videoData.videoId);
    dismissed = true;
  }

  async function resume() {
    const interrupted = interruptedDownloadStore.get(videoData.videoId);
    if (!interrupted) {
      return;
    }

    dismissed = true;
    interruptedDownloadStore.deleteLocal(videoData.videoId);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, {
      type: interrupted.type,
      videoId: videoData.videoId,
      videoItag: interrupted.videoItag,
      audioItag: interrupted.audioItag,
      filenameOutput: interrupted.filenameOutput,
      sabrConfig: videoData.sabrConfig
    });
  }

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === dismissButtonId) {
      dismiss();
    } else if (buttonId === retryButtonId) {
      retry();
    } else if (buttonId === resumeButtonId) {
      void resume();
    }
  }));
</script>

{#if showToast}
  <ytd-menu-popup-renderer class="ytdl-toast" aria-live="polite" role="status">
    <div class="ytdl-toast-content">
      <div class="ytdl-toast-body">
        {#if isDone}
          <yt-button-view-model class={scopingClass} {@attach attachDoneIcon}></yt-button-view-model>
          <div class="ytdl-toast-text">
            <span class="ytdl-toast-title">Download complete</span>
            <span class="ytdl-toast-filename">{interruptedState?.filenameOutput ?? progressState?.progressType ?? ""}</span>
          </div>
        {:else if isFailed}
          <yt-button-view-model
            class={scopingClass}
            {@attach attachGhostButton("!")}
          ></yt-button-view-model>
          <span class="ytdl-toast-title">Download failed</span>
        {:else if isInterrupted}
          <yt-button-view-model
            class={scopingClass}
            {@attach attachGhostButton("~")}
          ></yt-button-view-model>
          <span class="ytdl-toast-title">Download paused</span>
        {/if}
      </div>

      <div class="ytdl-toast-actions">
        {#if isFailed}
          <yt-button-view-model
            class={scopingClass}
            {@attach attachGhostButton("Retry")}
            data-ytdl-button-id={retryButtonId}
            role="button"
            tabindex="0"
          ></yt-button-view-model>
        {:else if isInterrupted}
          <yt-button-view-model
            class={scopingClass}
            {@attach attachResumeButton}
            data-ytdl-button-id={resumeButtonId}
            role="button"
            tabindex="0"
          ></yt-button-view-model>
        {/if}
        <yt-button-view-model
          class={scopingClass}
          {@attach attachCloseButton}
          data-ytdl-button-id={dismissButtonId}
          role="button"
          tabindex="0"
        ></yt-button-view-model>
      </div>
    </div>
  </ytd-menu-popup-renderer>
{/if}

<style>
  .ytdl-toast {
    position: fixed;
    bottom: 24px;
    left: 24px;
    z-index: 2300;
    min-width: 280px;
    max-width: 400px;
  }

  .ytdl-toast-content {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
  }

  .ytdl-toast-body {
    display: flex;
    flex: 1;
    gap: 8px;
    align-items: center;
  }

  .ytdl-toast-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ytdl-toast-title {
    font-weight: 500;
    font-size: 1.4rem;
  }

  .ytdl-toast-filename {
    overflow: hidden;
    max-width: 200px;
    font-size: 1.2rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 70%;
  }

  .ytdl-toast-actions {
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;
  }
</style>
