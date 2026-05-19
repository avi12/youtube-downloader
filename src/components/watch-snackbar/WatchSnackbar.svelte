<script lang="ts">
  import { crossWorldMessenger, CrossWorldMessage, onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { MessageType, sendMessage } from "@/lib/messaging/messaging";
  import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
  import { attachIcon } from "@/lib/ui/polymer-utils";
  import { YtIconName } from "@/types";

  const SNACKBAR_DURATION_MS = 10_000;
  const CLOSE_ANIMATION_MS = 500;
  const VIEW_BUTTON_ID = "ytdl-snackbar-view";
  let downloadId = $state<number | null>(null);
  let filename = $state("");
  let isOpen = $state(false);
  let isOpened = $state(false);
  let isClosing = $state(false);
  let elFilename = $state<HTMLSpanElement | null>(null);
  const canvasCtx = document.createElement("canvas").getContext("2d")!;
  const isFilenameTruncated = $derived.by(() => {
    if (!elFilename?.parentElement) {
      return false;
    }

    canvasCtx.font = getComputedStyle(elFilename).font;
    return canvasCtx.measureText(filename).width > elFilename.parentElement.clientWidth;
  });

  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function dismiss(): void {
    clearTimeout(dismissTimer ?? undefined);
    dismissTimer = null;
    isOpened = false;
    isClosing = true;
    closeTimer = setTimeout(() => {
      isOpen = false;
      isClosing = false;
    }, CLOSE_ANIMATION_MS);
  }

  $effect(() => completedDownloadsStore.subscribe((_videoId, completed) => {
    downloadId = completed.downloadId;
    filename = completed.filename;
    clearTimeout(closeTimer ?? undefined);
    closeTimer = null;
    isClosing = false;
    isOpen = true;
    requestAnimationFrame(() => {
      isOpened = true;
    });
    clearTimeout(dismissTimer ?? undefined);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.OpenSnackbar);
    dismissTimer = setTimeout(dismiss, SNACKBAR_DURATION_MS);
  }));

  $effect(() => onButtonClick(buttonId => {
    const isViewButtonWithDownload = buttonId === VIEW_BUTTON_ID && downloadId !== null;
    if (isViewButtonWithDownload) {
      void sendMessage(MessageType.RevealDownloadFile, { downloadId: downloadId! });
      dismiss();
    }
  }));

  function attachToSnackbar(elNode: HTMLElement): () => void {
    document.querySelector("snackbar-container")?.append(elNode);
    return () => elNode.remove();
  }
</script>

{#if isOpen}
  <div
    class="ytSnackbarContainerSnackbarContainer"
    class:ytSnackbarContainerClosed={isClosing}
    class:ytSnackbarContainerOpened={isOpened}
    {@attach attachToSnackbar}>
    <snackbar-view-model class="snackbarViewModelHost">
      <div class="snackbarViewModelEngagementBarWrapper">
        <div class="snackbarViewModelAvatarContainer">
          <yt-icon class="snackbarViewModelTitle" {@attach attachIcon(YtIconName.CheckCircle)}></yt-icon>
        </div>
        <div class="snackbarViewModelTitleSubtextWrapper">
          <div class="snackbarViewModelTitle snackbarViewModelTitleWithSubtext">
            <span class="ytAttributedStringHost ytAttributedStringWhiteSpacePreWrap">Download complete</span>
          </div>
          <div class="snackbarViewModelSubtext">
            <span bind:this={elFilename} class="ytAttributedStringHost">{filename}</span>
            {#if isFilenameTruncated}
              <tp-yt-paper-tooltip offset="8" position="top">
                {filename}
              </tp-yt-paper-tooltip>
            {/if}
          </div>
        </div>
        <!-- stylelint-disable-next-line custom-property-no-missing-var-function -->
        <div
          style:--tffc2fd3a644f6275="var(--t6216186c28b3834b)"
          class="snackbarViewModelButtonClassWrapper">
          <yt-button-view-model data-ytdl-button-id={VIEW_BUTTON_ID}></yt-button-view-model>
        </div>
      </div>
    </snackbar-view-model>
  </div>
{/if}
