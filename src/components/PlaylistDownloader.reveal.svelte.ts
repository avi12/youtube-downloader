import { revealAllPlaylistVideos } from "./PlaylistDownloader.scroll";
import type { VideoData } from "@/types";

export function createRevealState(
  getVideoDataMapSize: () => number,
  getDownloadableVideos: () => readonly VideoData[],
  startDownload: (videos: readonly VideoData[]) => Promise<void>
) {
  let isRevealingAll = $state(false);
  let revealedVideoCount = $state(0);
  let shouldStartDownloadAfterReveal = false;
  let abortReveal = false;

  async function revealAllVideos() {
    if (isRevealingAll) {
      return;
    }

    isRevealingAll = true;
    abortReveal = false;
    revealedVideoCount = getVideoDataMapSize();

    await revealAllPlaylistVideos(
      update => {
        revealedVideoCount = update.revealedCount;
      },
      () => abortReveal
    );

    isRevealingAll = false;

    if (abortReveal) {
      shouldStartDownloadAfterReveal = false;
      return;
    }

    if (shouldStartDownloadAfterReveal) {
      shouldStartDownloadAfterReveal = false;
      await startDownload(getDownloadableVideos());
    }
  }

  function cancelReveal() {
    abortReveal = true;
  }

  async function revealAndDownloadAll() {
    shouldStartDownloadAfterReveal = true;
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
