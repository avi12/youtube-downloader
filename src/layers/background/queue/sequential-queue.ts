import { required } from "@/lib/required";

const MAX_VIDEO_DOWNLOAD_MS = 10 * 60 * 1_000;

const completionCallbacks = new Map<string, Set<() => void>>();

export async function awaitVideoComplete(videoId: string) {
  return new Promise<void>((resolve, reject) => {
    function onComplete() {
      clearTimeout(timeoutId);
      resolve();
    }

    const timeoutId = setTimeout(() => {
      const callbacks = completionCallbacks.get(videoId);
      callbacks?.delete(onComplete);

      const isCallbacksEmpty = callbacks && !callbacks.size;
      if (isCallbacksEmpty) {
        completionCallbacks.delete(videoId);
      }

      reject(new Error(`Download timed out: ${videoId}`));
    }, MAX_VIDEO_DOWNLOAD_MS);
    const isCallbackSetMissing = !completionCallbacks.has(videoId);
    if (isCallbackSetMissing) {
      completionCallbacks.set(videoId, new Set());
    }

    required(completionCallbacks.get(videoId)).add(onComplete);
  });
}

export function signalVideoComplete(videoId: string) {
  const callbacks = completionCallbacks.get(videoId);
  completionCallbacks.delete(videoId);

  if (callbacks) {
    for (const callback of callbacks) {
      callback();
    }
  }
}


