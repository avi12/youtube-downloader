const MAX_VIDEO_DOWNLOAD_MS = 10 * 60 * 1_000;

const completionCallbacks = new Map<string, Set<() => void>>();
const bytesTransferredCallbacks = new Map<string, () => void>();

export async function awaitVideoComplete(videoId: string) {
  return new Promise<void>((resolve, reject) => {
    function onComplete() {
      clearTimeout(timeoutId);
      resolve();
    }

    const timeoutId = setTimeout(() => {
      const callbacks = completionCallbacks.get(videoId);
      callbacks?.delete(onComplete);

      if (callbacks && !callbacks.size) {
        completionCallbacks.delete(videoId);
      }

      reject(new Error(`Download timed out: ${videoId}`));
    }, MAX_VIDEO_DOWNLOAD_MS);
    if (!completionCallbacks.has(videoId)) {
      completionCallbacks.set(videoId, new Set());
    }

    completionCallbacks.get(videoId)!.add(onComplete);
  });
}

export function signalVideoComplete(videoId: string) {
  signalBytesTransferred(videoId);
  const callbacks = completionCallbacks.get(videoId);
  completionCallbacks.delete(videoId);

  if (callbacks) {
    for (const callback of callbacks) {
      callback();
    }
  }
}

export function awaitBytesTransferred(videoId: string) {
  return new Promise<void>(resolve => {
    bytesTransferredCallbacks.set(videoId, resolve);
  });
}

export function signalBytesTransferred(videoId: string) {
  const callback = bytesTransferredCallbacks.get(videoId);
  bytesTransferredCallbacks.delete(videoId);
  callback?.();
}
