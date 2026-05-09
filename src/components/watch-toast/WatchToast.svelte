<script lang="ts">
  import { MessageType, sendMessage } from "@/lib/messaging/messaging";
  import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";

  const TOAST_DURATION_MS = 4500;

  interface PaperToastElement extends HTMLElement {
    open: () => void;
    close: () => void;
    text: string;
  }

  let elToast = $state<PaperToastElement | null>(null);
  let downloadId = $state<number | null>(null);

  $effect(() => completedDownloadsStore.subscribe((_videoId, completed) => {
    if (!elToast) {
      return;
    }

    elToast.text = `Downloaded ${completed.filename}`;
    downloadId = completed.downloadId;
    elToast.open();
  }));

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

  function attachToBody(node: HTMLElement) {
    document.body.append(node);
    return {
      destroy() {
        node.remove();
      }
    };
  }
</script>

<tp-yt-paper-toast
  bind:this={elToast}
  class="ytdl-watch-toast"
  {@attach attachToBody}
  duration={TOAST_DURATION_MS}
>
  <yt-button-view-model
    class="ytdl-watch-toast__action"
    aria-label="View file"
    onclick={reveal}
    onkeydown={e => (e.key === "Enter" || e.key === " ") && reveal()}
    role="button"
    tabindex="0"
  >View</yt-button-view-model>
  <yt-button-view-model
    class="ytdl-watch-toast__action"
    aria-label="Dismiss"
    onclick={dismiss}
    onkeydown={e => (e.key === "Enter" || e.key === " ") && dismiss()}
    role="button"
    tabindex="0"
  >Dismiss</yt-button-view-model>
</tp-yt-paper-toast>

<style>
  .ytdl-watch-toast :global(.ytdl-watch-toast__action) {
    margin-inline-start: 8px;
  }
</style>
