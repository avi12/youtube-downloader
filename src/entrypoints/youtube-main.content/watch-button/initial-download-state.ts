import { CONTENT_OPTIONS, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import {
  CONTAINER_SPECS,
  MULTI_TRACK_UNSUPPORTED_EXTENSIONS,
  getCompatibleFilename,
  getOutputExtension,
  resolveAutoExtension
} from "@/lib/utils/containers";
import { selectPreferredAudioFormat } from "@/lib/youtube/video-helpers";
import { DownloadType, type VideoData } from "@/types";

const MKV_EXTENSION = "mkv";
const DEFAULT_VIDEO_MIME_TYPE = "video/mp4";
const DEFAULT_AUDIO_MIME_TYPE = "audio/mp4";

type PreferredAudioFormat = ReturnType<typeof selectPreferredAudioFormat>;

function getPreferredAudioFormat(videoData: VideoData) {
  const options = CONTENT_OPTIONS;
  const [firstVideoFormat] = videoData.videoFormats;
  const videoMime = firstVideoFormat?.mimeType ?? "";
  return selectPreferredAudioFormat({
    audioFormats: videoData.audioFormats,
    videoMimeType: videoMime,
    languageMode: options.audioTrackLanguageMode,
    locale: document.documentElement.lang,
    browserLanguage: navigator.language,
    customLanguage: options.customLanguage
  });
}

function resolveVideoExtension(videoData: VideoData, videoMime: string, audioMime: string, selectedTrackId?: string) {
  const userExtension = resolveAutoExtension({
    extension: CONTENT_OPTIONS.ext.video,
    mimeType: videoMime
  });
  const extension = getOutputExtension({
    videoMimeType: videoMime,
    audioMimeType: audioMime,
    userExtension
  });
  if (!selectedTrackId) {
    return extension;
  }

  const isOtherAudioTrackPresent = videoData.audioFormats.some(
    format => format.audioTrack?.id && format.audioTrack.id !== selectedTrackId
  );
  if (!isOtherAudioTrackPresent) {
    return extension;
  }

  const isMultiTrackSupported = extension in CONTAINER_SPECS && !MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(extension);
  return isMultiTrackSupported ? extension : MKV_EXTENSION;
}

function resolveOutputExtension(videoData: VideoData, preferredAudio: PreferredAudioFormat) {
  const [firstFormat] = videoData.videoFormats;
  const videoMime = firstFormat?.mimeType ?? DEFAULT_VIDEO_MIME_TYPE;
  const audioMime = preferredAudio?.mimeType ?? DEFAULT_AUDIO_MIME_TYPE;
  if (videoData.isMusic) {
    return resolveAutoExtension({
      extension: CONTENT_OPTIONS.ext.audio,
      mimeType: audioMime,
      isAudio: true
    });
  }

  return resolveVideoExtension(videoData, videoMime, audioMime, preferredAudio?.audioTrack?.id);
}

function resolveInitialItags(videoData: VideoData, preferredAudio: PreferredAudioFormat) {
  const [firstFormat] = videoData.videoFormats;
  const interrupted = interruptedDownloadStore.get(videoData.videoId);
  return {
    videoItag: interrupted?.videoItag || firstFormat?.itag || 0,
    audioItag: interrupted?.audioItag || preferredAudio?.itag || 0
  };
}

export function buildInitialDownloadState(videoData: VideoData) {
  const preferredAudio = getPreferredAudioFormat(videoData);
  const extension = resolveOutputExtension(videoData, preferredAudio);
  const filename = getCompatibleFilename(`${videoData.title || videoData.videoId}.${extension}`);
  const downloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;

  return {
    ...resolveInitialItags(videoData, preferredAudio),
    audioTrackId: preferredAudio?.audioTrack?.id,
    filename,
    quality: "",
    downloadType
  };
}
