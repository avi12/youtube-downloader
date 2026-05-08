<script lang="ts">
  import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";

  const TOAST_DURATION_MS = 4500;
  const FADE_TRANSITION_MS = 220;

  let isOpen = $state(false);
  let filename = $state("");
  let downloadId = $state<number | null>(null);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const unsubscribe = onMessage(MessageType.WatchDownloadCompleted, ({ data }) => {
      filename = data.filename;
      downloadId = data.downloadId;
      isOpen = true;
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
      hideTimer = setTimeout(() => (isOpen = false), TOAST_DURATION_MS);
    });
    return () => {
      unsubscribe();
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    };
  });

  function reveal() {
    if (downloadId === null) {
      return;
    }

    void sendMessage(MessageType.RevealDownloadFile, { downloadId });
    isOpen = false;
  }

  function dismiss() {
    isOpen = false;
  }
</script>

{#if isOpen}
  <div class="ytdl-watch-toast" role="status" aria-live="polite">
    <span class="ytdl-watch-toast__text">Downloaded {filename}</span>
    <yt-button-view-model
      class="ytdl-watch-toast__action"
      onclick={reveal}
      aria-label="View file"
      role="button"
      tabindex="0"
    >View</yt-button-view-model>
    <yt-button-view-model
      class="ytdl-watch-toast__action"
      onclick={dismiss}
      aria-label="Dismiss"
      role="button"
      tabindex="0"
    >Dismiss</yt-button-view-model>
  </div>
{/if}

<style>
  .ytdl-watch-toast {
    position: fixed;
    inset-block-end: 24px;
    inset-inline-start: 24px;
    z-index: 9999;
    display: flex;
    gap: 12px;
    align-items: center;
    padding-block: 12px;
    padding-inline: 16px;
    border-radius: 8px;
    background: var(--yt-spec-static-overlay-background-solid, light-dark(rgb(15 15 15), rgb(255 255 255)));
    color: var(--yt-spec-static-overlay-text-primary, light-dark(rgb(255 255 255), rgb(15 15 15)));
    box-shadow: 0 4px 16px rgb(0 0 0 / 30%);
    font-size: 14px;
    animation: ytdl-toast-in calc(var(--ytdl-fade) * 1ms) ease-out;
    --ytdl-fade: 220;
  }

  .ytdl-watch-toast__text {
    overflow: hidden;
    max-inline-size: 400px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes ytdl-toast-in {
    from {
      transform: translateY(8px);
      opacity: 0%;
    }

    to {
      transform: translateY(0);
      opacity: 100%;
    }
  }
</style>
