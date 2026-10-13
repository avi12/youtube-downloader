import { alignAudioFormatToExtension, pickBestByBitrate } from "./select-audio-format";
import { getOutputExtension, isVideoCodecPreferredForContainer } from "@/lib/utils/container-specs";
import type { AdaptiveFormatItem, CodecPreferences, Prettify, VideoData } from "@/types";

type ContainerAlignmentVideoData = Prettify<Pick<VideoData, "videoFormats" | "videoFormatVariants" | "audioFormats">>;

export function resolveVideoFormatVariants(videoData: Pick<VideoData, "videoFormats" | "videoFormatVariants">) {
  return videoData.videoFormatVariants ?? videoData.videoFormats;
}

type AlignVideoFormatToExtensionParams = Prettify<{
  videoFormatVariants: AdaptiveFormatItem[];
  currentFormat: AdaptiveFormatItem;
  targetExtension: string;
  codecPreferences: CodecPreferences;
}>;
export function alignVideoFormatToExtension({
  videoFormatVariants,
  currentFormat,
  targetExtension,
  codecPreferences
}: AlignVideoFormatToExtensionParams) {
  const isCurrentPreferred = isVideoCodecPreferredForContainer({
    videoMimeType: currentFormat.mimeType,
    targetExtension,
    codecPreferences
  });
  if (isCurrentPreferred) {
    return currentFormat;
  }

  const preferredSiblings = videoFormatVariants.filter(format =>
    format.height === currentFormat.height
    && format.fps === currentFormat.fps
    && isVideoCodecPreferredForContainer({
      videoMimeType: format.mimeType,
      targetExtension,
      codecPreferences
    }));
  return pickBestByBitrate(preferredSiblings) ?? currentFormat;
}

// Swaps video+audio picks for same-quality variants in the container's preferred
// codecs (MP4 -> H.264/AAC, WebM -> VP9/Opus) so they're copied, not re-encoded (issue #21)
type AlignFormatsToContainerParams = Prettify<{
  videoData: ContainerAlignmentVideoData;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem | null;
  targetExtension: string;
  codecPreferences: CodecPreferences;
}>;
export function alignFormatsToContainer({
  videoData, videoFormat, audioFormat, targetExtension, codecPreferences
}: AlignFormatsToContainerParams) {
  return {
    videoFormat: alignVideoFormatToExtension({
      videoFormatVariants: resolveVideoFormatVariants(videoData),
      currentFormat: videoFormat,
      targetExtension,
      codecPreferences
    }),
    audioFormat: audioFormat && alignAudioFormatToExtension({
      audioFormats: videoData.audioFormats,
      currentFormat: audioFormat,
      targetExtension,
      codecPreferences
    })
  };
}

type ResolveOutputExtensionForFormatsParams = Prettify<{
  videoData: ContainerAlignmentVideoData;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  userExtension: string;
  codecPreferences: CodecPreferences;
}>;
export function resolveOutputExtensionForFormats({
  videoData, videoFormat, audioFormat, userExtension, codecPreferences
}: ResolveOutputExtensionForFormatsParams) {
  const aligned = alignFormatsToContainer({
    videoData,
    videoFormat,
    audioFormat,
    targetExtension: userExtension,
    codecPreferences
  });
  return getOutputExtension({
    videoMimeType: aligned.videoFormat.mimeType,
    audioMimeType: (aligned.audioFormat ?? audioFormat).mimeType,
    userExtension
  });
}
