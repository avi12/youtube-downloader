import { contentOptions, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, getOutputExtension, resolveAutoExtension } from "@/lib/utils/containers";
import { selectPreferredAudioFormat } from "@/lib/youtube/video-helpers";
import { DownloadType, type VideoData } from "@/types";

function getActiveAudioTrackLanguage() {
  const audioTracks = document.querySelector("video")?.audioTracks;
  if (!audioTracks) {
    return undefined;
  }

  for (let i = 0; i < audioTracks.length; i++) {
    const { enabled, language } = audioTracks[i];
    if (enabled) {
      return language || undefined;
    }
  }

  return undefined;
}

function getPreferredAudioFormat(videoData: VideoData) {
  const options = contentOptions.value;
  const videoMime = videoData.videoFormats[0]?.mimeType ?? "";
  return selectPreferredAudioFormat({
    audioFormats: videoData.audioFormats,
    videoMimeType: videoMime,
    languageMode: options.audioTrackLanguageMode,
    locale: document.documentElement.lang,
    activeLanguage: getActiveAudioTrackLanguage()
  });
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

    const selectedTrackId = preferredAudio?.audioTrack?.id;
    const hasExtraAudioTracks = !!selectedTrackId &&
      videoData.audioFormats.some(format => format.audioTrack?.id && format.audioTrack.id !== selectedTrackId);
    if (hasExtraAudioTracks) {
      extension = "mkv";
    }
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
