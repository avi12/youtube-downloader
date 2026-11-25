// Counted from the last sign of progress: parallel 4K downloads take longer than this in total
const MAX_VIDEO_IDLE_MS = 10 * 60 * 1_000;

const completionCallbacks = new Map<string, Set<() => void>>();

const activityCallbacks = new Map<string, Set<() => void>>();

function addCallback({ callbacks, videoId, callback }: {
  callbacks: Map<string, Set<() => void>>;
  videoId: string;
  callback: () => void;
}) {
  const videoCallbacks = callbacks.get(videoId) ?? new Set();
  videoCallbacks.add(callback);
  callbacks.set(videoId, videoCallbacks);

  return () => {
    videoCallbacks.delete(callback);

    if (!videoCallbacks.size && callbacks.get(videoId) === videoCallbacks) {
      callbacks.delete(videoId);
    }
  };
}

export async function awaitVideoComplete({ videoId, signal }: {
  videoId: string;
  signal?: AbortSignal;
}) {
  return new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    function settle() {
      clearTimeout(timeoutId);
      removeCompletion();
      removeActivity();
    }

    function restartTimeout() {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        settle();
        reject(new Error(`Download timed out: ${videoId}`));
      }, MAX_VIDEO_IDLE_MS);
    }

    const removeCompletion = addCallback({
      callbacks: completionCallbacks,
      videoId,
      callback() {
        settle();
        resolve();
      }
    });
    const removeActivity = addCallback({
      callbacks: activityCallbacks,
      videoId,
      callback: restartTimeout
    });
    restartTimeout();
    signal?.addEventListener("abort", () => {
      settle();
      reject(signal.reason);
    }, { once: true });
  });
}

export function touchVideoActivity(videoId: string) {
  for (const callback of activityCallbacks.get(videoId) ?? []) {
    callback();
  }
}

export function signalVideoComplete(videoId: string) {
  for (const callback of completionCallbacks.get(videoId) ?? []) {
    callback();
  }
}


