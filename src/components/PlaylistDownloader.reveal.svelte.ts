import { revealAllPlaylistVideos } from "./PlaylistDownloader.scroll";
import type { VideoData } from "@/types";

export function createRevealState(
  getVideoDataMapSize: () => number,
  getDownloadableVideos: () => readonly VideoData[],
  startDownload: (videos: readonly VideoData[]) => Promise<void>
) {
  let isRevealingAll = $state(false);
  let revealedVideoCount = $state(0);
  let isDownloadPendingReveal = false;
  let isRevealCanceled = false;

  async function revealAllVideos() {
    if (isRevealingAll) {
      return;
    }

    isRevealingAll = true;
    isRevealCanceled = false;
    revealedVideoCount = getVideoDataMapSize();

    await revealAllPlaylistVideos(
      update => {
        revealedVideoCount = update.revealedCount;
      },
      () => isRevealCanceled
    );

    isRevealingAll = false;

    if (isRevealCanceled) {
      isDownloadPendingReveal = false;
      return;
    }

    if (isDownloadPendingReveal) {
      isDownloadPendingReveal = false;
      await startDownload(getDownloadableVideos());
    }
  }

  function cancelReveal() {
    isRevealCanceled = true;
  }

  async function revealAndDownloadAll() {
    isDownloadPendingReveal = true;
    await revealAllVideos();
  }

  return {
    get isRevealingAll() {
      return isRevealingAll;
    },
    get revealedVideoCount() {
      return revealedVideoCount;
    },
    revealAllVideos,
    cancelReveal,
    revealAndDownloadAll
  };
}
