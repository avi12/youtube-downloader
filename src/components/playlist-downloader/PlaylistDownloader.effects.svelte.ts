import type { createPlaylistActionButtons } from "./PlaylistDownloader.action-buttons.svelte";
import type { createPlaylistDownloaderState } from "./PlaylistDownloader.state.svelte";
import type { createPlaylistToggleButtons } from "./PlaylistDownloader.toggle-buttons.svelte";
import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
import { untrack } from "svelte";

export function setupPlaylistEffects({
  playlist,
  toggleButtons,
  actionButtons
}: {
  playlist: ReturnType<typeof createPlaylistDownloaderState>;
  toggleButtons: ReturnType<typeof createPlaylistToggleButtons>;
  actionButtons: ReturnType<typeof createPlaylistActionButtons>;
}) {
  $effect.pre(() => {
    void playlist.downloadMode;
    void playlist.outputMode;
    void playlist.effectiveDownloadType;
    void playlist.isDownloading;
    toggleButtons.refreshAll();
  });

  $effect(() => {
    void playlist.selectedDownloadableVideos.length;
    void playlist.isDownloading;
    actionButtons.refreshDeselectAll();
  });

  $effect(() => {
    void playlist.selectedDownloadableVideos.length;
    void playlist.isDownloading;
    void playlist.downloadButtonLabel;
    actionButtons.refreshDownload();
  });

  $effect(() => {
    void playlist.isRevealingAll;
    void playlist.isDownloading;
    void playlist.revealedVideoCount;
    void playlist.activeIndividualDownloadCount;
    actionButtons.refreshDownloadAll();
  });

  $effect(() => {
    void playlist.isDownloading;
    actionButtons.refreshStopAll();
  });

  $effect(() => onButtonClick(buttonId => {
    untrack(() => {
      const isHandled = actionButtons.handleClick(buttonId);
      if (isHandled) {
        return;
      }

      toggleButtons.handleClick(buttonId);
    });
  }));
}
