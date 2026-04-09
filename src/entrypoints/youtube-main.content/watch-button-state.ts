import { interruptedDownloadStore } from "@/lib/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension } from "@/lib/utils";
import { DownloadType, type VideoData } from "@/types";

interface DownloadButtonState {
  videoItag: number;
  audioItag: number;
  filename: string;
  quality: string;
  downloadType: DownloadType;
  isInterrupted: boolean;
}

export function buildInitialDownloadState(videoData: VideoData): DownloadButtonState {
  let videoItag = videoData.videoFormats[0]?.itag ?? 0;
  let audioItag = videoData.audioFormats[0]?.itag ?? 0;
  const videoMime = videoData.videoFormats[0]?.mimeType ?? "video/mp4";
  const audioMime = videoData.audioFormats[0]?.mimeType ?? "audio/mp4";

  let extension: string;
  if (videoData.isMusic) {
    extension = audioMime.includes("webm") ? "webm" : "m4a";
  } else {
    extension = getOutputExtension(videoMime, audioMime, "mp4");
  }

  const filename = getCompatibleFilename(`${videoData.title}.${extension}`);
  const downloadType: DownloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;

  let isInterrupted = false;
  const interrupted = interruptedDownloadStore.get(videoData.videoId);
  if (interrupted) {
    isInterrupted = true;
    videoItag = interrupted.videoItag || videoItag;
    audioItag = interrupted.audioItag || audioItag;
  }

  return { videoItag, audioItag, filename, quality: "", downloadType, isInterrupted };
}
