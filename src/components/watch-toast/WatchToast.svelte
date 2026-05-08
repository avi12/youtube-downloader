<script lang="ts">
  import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";

  const TOAST_DURATION_MS = 4500;

  let elToast = $state<HTMLElement & { open: () => void; close: () => void } | null>(null);
  let filename = $state("");
  let downloadId = $state<number | null>(null);

  $effect(() => {
    const unsubscribe = onMessage(MessageType.WatchDownloadCompleted, ({ data }) => {
      filename = data.filename;
      downloadId = data.downloadId;
      elToast?.open();
    });
    return unsubscribe;
  });

  function reveal() {
    if (downloadId === null) {
      return;
    }

    void sendMessage(MessageType.RevealDownloadFile, { downloadId });
    elToast?.close();
  }

  function dismiss() {
    elToast?.close();
  }

  function handleKey(action: () => void) {
    return (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        action();
      }
    };
  }
</script>

<tp-yt-paper-toast
  bind:this={elToast}
  class="ytdl-watch-toast"
  duration={TOAST_DURATION_MS}
  text="Downloaded {filename}"
>
  <yt-button-view-model
    onclick={reveal}
    onkeydown={handleKey(reveal)}
    aria-label="View file"
    role="button"
    tabindex="0"
  >View</yt-button-view-model>
  <yt-button-view-model
    onclick={dismiss}
    onkeydown={handleKey(dismiss)}
    aria-label="Dismiss"
    role="button"
    tabindex="0"
  >Dismiss</yt-button-view-model>
</tp-yt-paper-toast>

<style>
  .ytdl-watch-toast :global(yt-button-view-model) {
    margin-inline-start: 8px;
  }
</style>
