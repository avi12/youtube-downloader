import { alignAudioFormatToExtension, pickBestByBitrate } from "./select-audio-format";
import { getOutputExtension, isVideoCodecPreferredForContainer } from "@/lib/utils/container-specs";
import type { AdaptiveFormatItem, Prettify, VideoData } from "@/types";

type ContainerAlignmentVideoData = Prettify<Pick<VideoData, "videoFormats" | "videoFormatVariants" | "audioFormats">>;

export function resolveVideoFormatVariants(videoData: Pick<VideoData, "videoFormats" | "videoFormatVariants">) {
  return videoData.videoFormatVariants ?? videoData.videoFormats;
}

type AlignVideoFormatToExtensionParams = Prettify<{
  videoFormatVariants: AdaptiveFormatItem[];
  currentFormat: AdaptiveFormatItem;
  targetExtension: string;
}>;
function alignVideoFormatToExtension({
  videoFormatVariants,
  currentFormat,
  targetExtension
}: AlignVideoFormatToExtensionParams) {
  const isCurrentPreferred = isVideoCodecPreferredForContainer({
    videoMimeType: currentFormat.mimeType,
    targetExtension
  });
  if (isCurrentPreferred) {
    return currentFormat;
  }

  const preferredSiblings = videoFormatVariants.filter(format =>
    format.height === currentFormat.height
    && format.fps === currentFormat.fps
    && isVideoCodecPreferredForContainer({
      videoMimeType: format.mimeType,
      targetExtension
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
}>;
export function alignFormatsToContainer({
  videoData, videoFormat, audioFormat, targetExtension
}: AlignFormatsToContainerParams) {
  return {
    videoFormat: alignVideoFormatToExtension({
      videoFormatVariants: resolveVideoFormatVariants(videoData),
      currentFormat: videoFormat,
      targetExtension
    }),
    audioFormat: audioFormat && alignAudioFormatToExtension({
      audioFormats: videoData.audioFormats,
      currentFormat: audioFormat,
      targetExtension
    })
  };
}

type ResolveOutputExtensionForFormatsParams = Prettify<{
  videoData: ContainerAlignmentVideoData;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  userExtension: string;
}>;
export function resolveOutputExtensionForFormats({
  videoData, videoFormat, audioFormat, userExtension
}: ResolveOutputExtensionForFormatsParams) {
  const aligned = alignFormatsToContainer({
    videoData,
    videoFormat,
    audioFormat,
    targetExtension: userExtension
  });
  return getOutputExtension({
    videoMimeType: aligned.videoFormat.mimeType,
    audioMimeType: (aligned.audioFormat ?? audioFormat).mimeType,
    userExtension
  });
}
