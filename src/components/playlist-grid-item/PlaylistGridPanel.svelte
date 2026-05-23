<script lang="ts">
  import PlaylistGridFormatSections from "./PlaylistGridFormatSections.svelte";
  import type { createPlaylistGridItemState } from "./PlaylistGridItem.state.svelte";
  import PlaylistGridPanelFooter from "./PlaylistGridPanelFooter.svelte";
  import { createFocusManager } from "@/components/download-options-panel/DownloadOptionsPanel.focus.svelte";
  import {
    HEADER_CLOSE_BUTTON_ID,
    sendPanelClosed
  } from "@/components/download-options-panel/DownloadOptionsPanel.handlers.ts";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { attachCloseButton } from "@/lib/ui/panel-button-attachments.svelte";

  const scopingClass = document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")
    ?.getAttribute("class") ?? "";

  interface Props {
    playlistId: string;
    state: ReturnType<typeof createPlaylistGridItemState>;
  }

  const { playlistId, state }: Props = $props();

  const focusManager = createFocusManager();

  function closePanel(): void {
    focusManager.release();
    sendPanelClosed();
  }

  $effect(() => {
    void state.ensureMetadataLoaded();
  });

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === HEADER_CLOSE_BUTTON_ID) {
      closePanel();
    }
  }));
</script>

<div
  class="ytdl-panel"
  {@attach focusManager.attach}
  aria-labelledby="ytdl-grid-panel-title-{playlistId}"
  aria-modal="true"
  role="dialog"
  tabindex="-1"
>
  <div class="ytdl-panel-header">
    <h2 id="ytdl-grid-panel-title-{playlistId}" class="ytdl-panel-title">Download playlist</h2>
    <yt-button-view-model
      class={scopingClass}
      {@attach attachCloseButton}
      aria-label="Close"
      data-ytdl-button-id={HEADER_CLOSE_BUTTON_ID}
      role="button"
      tabindex="0"
    ></yt-button-view-model>
  </div>

  <div class="ytdl-panel-body">
    <PlaylistGridFormatSections {playlistId} {state} />

    {#if state.errorMessage}
      <div class="ytdl-error-banner" role="alert">{state.errorMessage}</div>
    {/if}
  </div>

  <PlaylistGridPanelFooter {playlistId} {scopingClass} {state} />
</div>
