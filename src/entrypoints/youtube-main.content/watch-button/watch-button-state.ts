import { interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension } from "@/lib/utils/containers";
import { DownloadType, ProgressType, type VideoData } from "@/types";

export interface ButtonState {
  isDownloading: boolean;
  isDone: boolean;
  isInterrupted: boolean;
  isError: boolean;
  isPanelOpen: boolean;
  downloadProgress: number;
  downloadProgressType: ProgressType | "";
  defaultVideoItag: number;
  defaultAudioItag: number;
  defaultFilename: string;
  defaultQuality: string;
  defaultDownloadType: DownloadType;
  lastProgressReported: number;
  lastRenderedButtonKey: string;
  lastRenderedChevronKey: string;
}

export function buildInitialDownloadState(videoData: VideoData) {
  let videoItag = videoData.videoFormats[0]?.itag ?? 0;
  let audioItag = videoData.audioFormats[0]?.itag ?? 0;
  const videoMime = videoData.videoFormats[0]?.mimeType ?? "video/mp4";
  const audioMime = videoData.audioFormats[0]?.mimeType ?? "audio/mp4";

  let extension: string;
  if (videoData.isMusic) {
    extension = audioMime.includes("webm") ? "webm" : "m4a";
  } else {
    extension = getOutputExtension({
      videoMimeType: videoMime,
      audioMimeType: audioMime,
      userExtension: "mp4"
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
