import type { RecentDownloadContext } from "@/lib/messaging/messaging";
import type { ProcessStreamData } from "@/types";

export { initMuxWorker } from "./ffmpeg-instance";
export { triggerDownload } from "./blob-download";
export { reportProgress } from "./progress-reporter";
export { enqueueStreamData, cancelDownloadsByIds } from "./stream-processor";

export const FFMPEG_PROGRESS_CAP = 0.99;

export function buildRecentContext(
  item: Pick<ProcessStreamData, "videoId" | "filenameOutput" | "metadata">,
  extras?: Partial<RecentDownloadContext>
): RecentDownloadContext {
  return {
    videoId: item.videoId,
    title: item.metadata?.title ?? item.filenameOutput,
    channel: item.metadata?.artist ?? "",
    thumbnailUrl: item.metadata?.thumbnailUrl,
    ...extras
  };
}

export function toOwnedArrayBuffer(view: ArrayBufferView) {
  const isSharedBuffer = !(view.buffer instanceof ArrayBuffer);
  if (isSharedBuffer) {
    throw new Error("SharedArrayBuffer is not supported");
  }

  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function toUint8Array(data: Uint8Array | Record<string, number> | null) {
  if (!data) {
    return null;
  }

  const isNotArrayBufferView = !ArrayBuffer.isView(data);
  if (isNotArrayBufferView) {
    return new Uint8Array(Object.values(data));
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
