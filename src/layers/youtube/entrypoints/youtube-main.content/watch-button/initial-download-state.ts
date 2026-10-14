import { CONTENT_OPTIONS, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";
import {
  CONTAINER_SPECS,
  MULTI_TRACK_UNSUPPORTED_EXTENSIONS,
  getCompatibleFilename,
  getOutputExtension,
  resolveAutoExtension
} from "@/lib/utils/containers";
import { resolveOutputExtensionForFormats } from "@/lib/youtube/align-formats-to-container";
import { resolveDownloadType } from "@/lib/youtube/download-type";
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

function resolveBaseVideoExtension(videoData: VideoData, preferredAudio: PreferredAudioFormat) {
  const [firstFormat] = videoData.videoFormats;
  const userExtension = resolveAutoExtension({
    extension: CONTENT_OPTIONS.ext.video,
    mimeType: firstFormat?.mimeType ?? DEFAULT_VIDEO_MIME_TYPE
  });
  if (!firstFormat || !preferredAudio) {
    return getOutputExtension({
      videoMimeType: firstFormat?.mimeType ?? DEFAULT_VIDEO_MIME_TYPE,
      audioMimeType: preferredAudio?.mimeType ?? DEFAULT_AUDIO_MIME_TYPE,
      userExtension
    });
  }

  return resolveOutputExtensionForFormats({
    videoData,
    videoFormat: firstFormat,
    audioFormat: preferredAudio,
    userExtension,
    codecPreferences: CONTENT_OPTIONS
  });
}

function resolveVideoExtension(videoData: VideoData, preferredAudio: PreferredAudioFormat) {
  const extension = resolveBaseVideoExtension(videoData, preferredAudio);
  const selectedTrackId = preferredAudio?.audioTrack?.id;
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

function resolveOutputExtension({ videoData, preferredAudio, downloadType }: {
  videoData: VideoData;
  preferredAudio: PreferredAudioFormat;
  downloadType: DownloadType;
}) {
  const isAudioDownload = downloadType === DownloadType.Audio;
  if (isAudioDownload) {
    return resolveAutoExtension({
      extension: CONTENT_OPTIONS.ext.audio,
      mimeType: preferredAudio?.mimeType ?? DEFAULT_AUDIO_MIME_TYPE,
      isAudio: true
    });
  }

  return resolveVideoExtension(videoData, preferredAudio);
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
  const downloadType = resolveDownloadType({
    preference: CONTENT_OPTIONS.defaultDownloadType,
    isMusic: videoData.isMusic
  });
  const extension = resolveOutputExtension({
    videoData,
    preferredAudio,
    downloadType
  });
  const filename = getCompatibleFilename(`${videoData.title || videoData.videoId}.${extension}`);

  return {
    ...resolveInitialItags(videoData, preferredAudio),
    audioTrackId: preferredAudio?.audioTrack?.id,
    filename,
    quality: "",
    downloadType
  };
}
