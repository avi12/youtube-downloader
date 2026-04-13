const MaxVideoDownloadMs = 10 * 60 * 1_000;

const completionCallbacks = new Map<string, () => void>();

export async function awaitVideoComplete(videoId: string) {
  return new Promise<void>(resolve => {
    const timeoutId = setTimeout(() => {
      completionCallbacks.delete(videoId);
      resolve();
    }, MaxVideoDownloadMs);

    completionCallbacks.set(videoId, () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

export function signalVideoComplete(videoId: string) {
  const callback = completionCallbacks.get(videoId);
  completionCallbacks.delete(videoId);
  callback?.();
}
