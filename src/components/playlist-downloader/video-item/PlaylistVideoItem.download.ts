import { batchCanceledIds, batchDownloadStatus, batchVideoIds } from "../PlaylistDownloader.batch.svelte";
import { cancelStreamTransfer } from "@/entrypoints/youtube.content/download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { checkedPlaylistVideos } from "@/lib/ui/playlist-selection.svelte";
import { CONTENT_OPTIONS, downloadProgressStore } from "@/lib/ui/synced-stores.svelte";
import { resolveVideoFilename } from "@/lib/utils/containers";
import { DownloadType, type VideoData } from "@/types";

type TriggerDownloadParams = {
  videoData: VideoData;
  videoId: string;
  gridTitle: string | undefined;
  setLocallyDone: (value: boolean) => void;
};
export function triggerDownload({ videoData, videoId, gridTitle, setLocallyDone }: TriggerDownloadParams) {
  const options = CONTENT_OPTIONS;
  let downloadType: DownloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;
  const isExplicitType = options.defaultDownloadType && options.defaultDownloadType !== DownloadType.Auto;
  if (isExplicitType) {
    downloadType = options.defaultDownloadType;
  }

  const filenameOutput = resolveVideoFilename({
    videoData,
    options,
    titleOverride: gridTitle
  });

  setLocallyDone(false);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, {
    type: downloadType,
    videoId,
    videoItag: videoData.videoFormats[0]?.itag ?? 0,
    audioItag: videoData.audioFormats[0]?.itag ?? 0,
    filenameOutput
  });
}

export function cancelDownload(videoId: string) {
  downloadProgressStore.delete(videoId);
  cancelStreamTransfer(videoId);
  void sendMessage(MessageType.CancelDownload, { videoIds: [videoId] });

  if (batchDownloadStatus.isRunning && batchVideoIds.has(videoId)) {
    batchCanceledIds.add(videoId);
    checkedPlaylistVideos.delete(videoId);
  }
}
