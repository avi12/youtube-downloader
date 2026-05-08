<script lang="ts">
  import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";

  const TOAST_DURATION_MS = 4500;

  interface PaperToastElement extends HTMLElement {
    open: () => void;
    close: () => void;
    text: string;
  }

  let elToast = $state<PaperToastElement | null>(null);
  let downloadId = $state<number | null>(null);

  $effect(() => {
    const unsubscribe = onMessage(MessageType.WatchDownloadCompleted, ({ data }) => {
      if (!elToast) {
        return;
      }

      elToast.text = `Downloaded ${data.filename}`;
      downloadId = data.downloadId;
      elToast.open();
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
  duration={TOAST_DURATION_MS}
  {@attach attachToBody}
>
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
</tp-yt-paper-toast>

<style>
  .ytdl-watch-toast :global(.ytdl-watch-toast__action) {
    margin-inline-start: 8px;
  }
</style>
