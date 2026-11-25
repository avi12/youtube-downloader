import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataFailedStore, videoDataStore } from "@/lib/ui/synced-stores.svelte";

// Settles once the video's data is known: whether it can be downloaded, or false when it failed to
// load. A video item mounts only after this, so it never shows a guessed state. There is no timeout
// here: requests queue behind each other, and the fetch itself is what times out
export function resolveVideoDownloadability(videoId: string) {
  return new Promise<boolean>(resolve => {
    const effects: {
       isSettled: boolean;
       stop?: () => void 
    } = { isSettled: false };
    function settle(isDownloadable: boolean) {
      effects.isSettled = true;
      effects.stop?.();
      resolve(isDownloadable);
    }

    async function requestUntilSettled() {
      while (!effects.isSettled) {
        const isRequested = await crossWorldMessenger
          .sendMessage(CrossWorldMessage.RequestVideoData, { videoId })
          .then(() => true, () => false);
        if (isRequested) {
          return;
        }

        await new Promise(requestAnimationFrame);
      }
    }

    effects.stop = $effect.root(() => {
      $effect(() => {
        const videoData = videoDataStore.get(videoId);
        if (videoData) {
          settle(videoData.isDownloadable);
          return;
        }

        if (videoDataFailedStore.get(videoId)) {
          settle(false);
        }
      });
    });

    if (effects.isSettled) {
      effects.stop();
    }

    requestUntilSettled().catch(() => settle(false));
  });
}
