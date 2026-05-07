const MAX_VIDEO_DOWNLOAD_MS = 10 * 60 * 1_000;

const completionCallbacks = new Map<string, () => void>();
const bytesTransferredCallbacks = new Map<string, () => void>();

export async function awaitVideoComplete(videoId: string) {
  return new Promise<void>(resolve => {
    const timeoutId = setTimeout(() => {
      completionCallbacks.delete(videoId);
      resolve();
    }, MAX_VIDEO_DOWNLOAD_MS);

    completionCallbacks.set(videoId, () => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

export function signalVideoComplete(videoId: string) {
  signalBytesTransferred(videoId);
  const callback = completionCallbacks.get(videoId);
  completionCallbacks.delete(videoId);
  callback?.();
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
