import { contentOptions, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import { DownloadType, type VideoData } from "@/types";

function getPreferredAudioFormat(videoData: VideoData) {
  const videoMime = videoData.videoFormats[0]?.mimeType ?? "";
  if (videoMime.includes("webm")) {
    return videoData.audioFormats.find(format => format.mimeType.includes("webm")) ?? videoData.audioFormats[0] ?? null;
  }

  return videoData.audioFormats[0] ?? null;
}

export function buildInitialDownloadState(videoData: VideoData) {
  let videoItag = videoData.videoFormats[0]?.itag ?? 0;
  const preferredAudio = getPreferredAudioFormat(videoData);
  let audioItag = preferredAudio?.itag ?? 0;
  const videoMime = videoData.videoFormats[0]?.mimeType ?? "video/mp4";
  const audioMime = preferredAudio?.mimeType ?? "audio/mp4";

  const options = contentOptions.value;
  let extension: string;
  if (videoData.isMusic) {
    extension = resolveAutoExtension({
      extension: options.ext.audio,
      mimeType: audioMime
    });
  } else {
    const resolvedVideoExtension = resolveAutoExtension({
      extension: options.ext.video,
      mimeType: videoMime
    });
    extension = getOutputExtension({
      videoMimeType: videoMime,
      audioMimeType: audioMime,
      userExtension: resolvedVideoExtension
    });
  }

  const filename = getCompatibleFilename(`${videoData.title || videoData.videoId}.${extension}`);
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
