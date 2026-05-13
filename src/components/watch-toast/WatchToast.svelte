<script lang="ts">
  import { crossWorldMessenger, CrossWorldMessage, onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { MessageType, sendMessage } from "@/lib/messaging/messaging";
  import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";

  const TOAST_DURATION_MS = 10000;
  const VIEW_BUTTON_ID = "ytdl-toast-view";

  let downloadId = $state<number | null>(null);
  let filename = $state("");
  let isOpen = $state(false);
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => completedDownloadsStore.subscribe((_videoId, completed) => {
    downloadId = completed.downloadId;
    filename = completed.filename;
    isOpen = true;
    clearTimeout(dismissTimer ?? undefined);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.OpenToast, {});
    dismissTimer = setTimeout(() => {
      isOpen = false;
    }, TOAST_DURATION_MS);
  }));

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === VIEW_BUTTON_ID && downloadId !== null) {
      void sendMessage(MessageType.RevealDownloadFile, { downloadId });
      isOpen = false;
    }
  }));

  function attachToSnackbar(node: HTMLElement) {
    document.querySelector("snackbar-container")?.append(node);
    return () => node.remove();
  }
</script>

{#if isOpen}
  <div class="ytSnackbarContainerSnackbarContainer ytSnackbarContainerOpened" {@attach attachToSnackbar}>
    <snackbar-view-model class="snackbarViewModelHost">
      <div class="snackbarViewModelEngagementBarWrapper">
        <yt-icon class="snackbarViewModelAvatarContainer" icon="icons:check-circle"></yt-icon>
        <div class="snackbarViewModelTitleSubtextWrapper">
          <div class="snackbarViewModelTitle snackbarViewModelTitleWithSubtext">
            <!-- svelte-ignore a11y_unknown_role -->
            <span
              class="ytAttributedStringHost ytAttributedStringWhiteSpacePreWrap"
              role="text"
            >Download complete</span>
          </div>
          <div class="snackbarViewModelSubtext">
            <!-- svelte-ignore a11y_unknown_role -->
            <span class="ytAttributedStringHost" role="text">{filename}</span>
          </div>
        </div>
        <div class="snackbarViewModelButtonClassWrapper">
          <yt-button-view-model data-ytdl-button-id={VIEW_BUTTON_ID}></yt-button-view-model>
        </div>
      </div>
    </snackbar-view-model>
  </div>
{/if}
