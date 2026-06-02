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

export function buildInitialDownloadState(videoData: VideoData) {
  const [firstFormat] = videoData.videoFormats;
  let videoItag = firstFormat?.itag ?? 0;
  const preferredAudio = getPreferredAudioFormat(videoData);
  let audioItag = preferredAudio?.itag ?? 0;
  const videoMime = firstFormat?.mimeType ?? DEFAULT_VIDEO_MIME_TYPE;
  const audioMime = preferredAudio?.mimeType ?? DEFAULT_AUDIO_MIME_TYPE;

  const options = CONTENT_OPTIONS;
  let extension: string;
  if (videoData.isMusic) {
    extension = resolveAutoExtension({
      extension: options.ext.audio,
      mimeType: audioMime,
      isAudio: true
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
    const isTrackSelected = Boolean(selectedTrackId);
    const isOtherAudioTrackPresent = videoData.audioFormats.some(
      format => format.audioTrack?.id && format.audioTrack.id !== selectedTrackId
    );
    const isMultiTrack = isTrackSelected && isOtherAudioTrackPresent;
    if (isMultiTrack) {
      const isKnownContainer = extension in CONTAINER_SPECS;
      const isMultiTrackUnsupported = MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(extension);
      const isUnsupportedMultiTrackContainer = !isKnownContainer || isMultiTrackUnsupported;
      if (isUnsupportedMultiTrackContainer) {
        extension = MKV_EXTENSION;
      }
    }
  }

  const filename = getCompatibleFilename(`${videoData.title || videoData.videoId}.${extension}`);
  const downloadType = videoData.isMusic ? DownloadType.Audio : DownloadType.VideoAndAudio;

  const interrupted = interruptedDownloadStore.get(videoData.videoId);
  if (interrupted) {
    videoItag = interrupted.videoItag || videoItag;
    audioItag = interrupted.audioItag || audioItag;
  }

  return {
    videoItag,
    audioItag,
    audioTrackId: preferredAudio?.audioTrack?.id,
    filename,
    quality: "",
    downloadType
  };
}
