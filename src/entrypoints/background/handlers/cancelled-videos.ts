// In-memory cancellation tracking, deliberately free of any storage import so it
// can be used from the offscreen download-worker iframe (which cannot use
// wxt/storage). Keeping this separate from `pipeline-state` (which writes
// statusProgress) is what stops `storage.ts` from being pulled into the worker
// bundle, where its eager defineItem reads throw.
const cancelledVideoIds = new Set<string>();

export function markVideosCancelled(videoIds: string[]) {
  for (const videoId of videoIds) {
    cancelledVideoIds.add(videoId);
  }
}

export function isVideoCancelled(videoId: string) {
  return cancelledVideoIds.has(videoId);
}

export function clearCancelledVideo(videoId: string) {
  cancelledVideoIds.delete(videoId);
}
