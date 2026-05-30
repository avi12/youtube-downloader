import type { RecentDownloadContext } from "@/lib/messaging/messaging";
import type { ProcessStreamData } from "@/types";

export { initMuxWorker } from "./ffmpeg-instance";
export { triggerDownload } from "./blob-download";
export { reportProgress } from "./progress-reporter";
export { enqueueStreamData, cancelDownloadsByIds } from "./stream-processor";

export const FFMPEG_PROGRESS_CAP = 0.99;

type BuildRecentContextParams = {
  item: Pick<ProcessStreamData, "videoId" | "filenameOutput" | "metadata" | "tabId" | "quality">;
  extras?: Partial<RecentDownloadContext>;
};
export function buildRecentContext({ item, extras }: BuildRecentContextParams) {
  return {
    videoId: item.videoId,
    title: item.metadata?.title ?? item.filenameOutput,
    channel: item.metadata?.artist ?? "",
    thumbnailUrl: item.metadata?.thumbnailUrl,
    tabId: item.tabId,
    quality: item.quality,
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
  const isDataMissing = !data;
  if (isDataMissing) {
    return null;
  }

  const isArrayBufferView = ArrayBuffer.isView(data);
  if (!isArrayBufferView) {
    return new Uint8Array(Object.values(data));
  }

  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
