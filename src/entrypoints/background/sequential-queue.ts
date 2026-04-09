/**
 * Completion signaling for sequential playlist dispatch.
 * download-handlers.ts awaits per-video completion; pipeline-handlers.ts signals it.
 */

const MaxVideoDownloadMs = 10 * 60 * 1_000;

const completionCallbacks = new Map<string, () => void>();

export function awaitVideoComplete(videoId: string): Promise<void> {
  return new Promise(resolve => {
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
