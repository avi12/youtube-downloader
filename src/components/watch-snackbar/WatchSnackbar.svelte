<script lang="ts">
  import { crossWorldMessenger, CrossWorldMessage, onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { MessageType, sendMessage } from "@/lib/messaging/messaging";
  import { completedDownloadsStore } from "@/lib/ui/completed-downloads-store.svelte";
  import { attachIcon } from "@/lib/ui/polymer-utils";
  import { YtIconName } from "@/types";

  const SNACKBAR_DURATION_MS = 10_000;
  const VIEW_BUTTON_ID = "ytdl-snackbar-view";

  let downloadId = $state<number | null>(null);
  let filename = $state("");
  let isOpen = $state(false);
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => completedDownloadsStore.subscribe((_videoId, completed) => {
    downloadId = completed.downloadId;
    filename = completed.filename;
    isOpen = true;
    clearTimeout(dismissTimer ?? undefined);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.OpenSnackbar);
    dismissTimer = setTimeout(() => {
      isOpen = false;
    }, SNACKBAR_DURATION_MS);
  }));

  $effect(() => onButtonClick(buttonId => {
    const isViewButtonWithDownload = buttonId === VIEW_BUTTON_ID && downloadId !== null;
    if (isViewButtonWithDownload) {
      void sendMessage(MessageType.RevealDownloadFile, { downloadId: downloadId! });
      clearTimeout(dismissTimer ?? undefined);
      dismissTimer = null;
      isOpen = false;
    }
  }));

  function attachToSnackbar(node: HTMLElement) {
    document.querySelector("snackbar-container")?.append(node);
    return () => node.remove();
  }
</script>

<style>
  /* The snackbar uses a light surface even when YouTube is in dark mode, so the
     check icon's currentColor (inherited from the dark-theme text token) ends up
     near-white on a near-white background. Pin it to the inverse text token so
     it reads as dark against the snackbar. */
  :global([dark] snackbar-container .snackbarViewModelAvatarContainer yt-icon) {
    color: var(--yt-sys-color-baseline--text-primary-inverse, #0f0f0f);
  }
</style>

{#if isOpen}
  <div class="ytSnackbarContainerSnackbarContainer ytSnackbarContainerOpened" {@attach attachToSnackbar}>
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
            <span class="ytAttributedStringHost">{filename}</span>
          </div>
        </div>
        <div class="snackbarViewModelButtonClassWrapper">
          <yt-button-view-model data-ytdl-button-id={VIEW_BUTTON_ID}></yt-button-view-model>
        </div>
      </div>
    </snackbar-view-model>
  </div>
{/if}
