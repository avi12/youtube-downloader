import { contentOptions, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import { DownloadType, type VideoData } from "@/types";

export function buildInitialDownloadState(videoData: VideoData) {
  let videoItag = videoData.videoFormats[0]?.itag ?? 0;
  let audioItag = videoData.audioFormats[0]?.itag ?? 0;
  const videoMime = videoData.videoFormats[0]?.mimeType ?? "video/mp4";
  const audioMime = videoData.audioFormats[0]?.mimeType ?? "audio/mp4";

  const options = contentOptions.value;
  let extension: string;
  if (videoData.isMusic) {
    extension = resolveAutoExtension({
      extension: options.ext.audio,
      mimeType: audioMime,
      type: DownloadType.Audio
    });
  } else {
    const resolvedVideoExtension = resolveAutoExtension({
      extension: options.ext.video,
      mimeType: videoMime,
      type: DownloadType.Video
    });
    extension = getOutputExtension({
      videoMimeType: videoMime,
      audioMimeType: audioMime,
      userExtension: resolvedVideoExtension
    });
  }

  const filename = getCompatibleFilename(`${videoData.title}.${extension}`);
  const downloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;

  let isInterrupted = false;
  const interrupted = interruptedDownloadStore.get(videoData.videoId);
  if (interrupted) {
    isInterrupted = true;
    videoItag = interrupted.videoItag || videoItag;
    audioItag = interrupted.audioItag || audioItag;
  }

  return {
    videoItag,
    audioItag,
    filename,
    quality: "",
    downloadType,
    isInterrupted
  };
}
