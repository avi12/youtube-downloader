import { createVideoFormatPreference, resolveVideoFormatVariants } from "./align-formats-to-container";
import { filterVideoFormatsByEnhancedBitrate } from "./format-display";
import { resolveAutoExtension } from "@/lib/utils/mime-types";
import { VideoQualityMode, type Options, type Prettify, type VideoData } from "@/types";

// "Best" stops at the highest quality the container's preferred codec offers, like
// yt-dlp's -f [vcodec^=avc1] for MP4 (H.264 tops out at 1080p); an explicit pick is kept
type SelectVideoFormatForQualityParams = Prettify<{
  videoData: Pick<VideoData, "videoFormats" | "videoFormatVariants">;
  options: Pick<Options, "videoQualityMode" | "videoQuality" | "enhancedBitrate" | "videoCodec" | "audioCodec" | "dynamicRange">;
  targetExtension: string;
}>;
export function selectVideoFormatForQuality({
  videoData, options, targetExtension
}: SelectVideoFormatForQualityParams) {
  const candidates = filterVideoFormatsByEnhancedBitrate(videoData.videoFormats, options.enhancedBitrate);
  const isBestQualityMode = options.videoQualityMode === VideoQualityMode.Best;
  if (!isBestQualityMode) {
    return candidates.find(format => format.height === options.videoQuality) ?? candidates[0] ?? null;
  }

  const variants = resolveVideoFormatVariants(videoData);
  const preferredVariants = variants.filter(
    createVideoFormatPreference({
      videoFormatVariants: variants,
      targetExtension,
      codecPreferences: options
    }).isPreferred
  );
  const bestPreferredFormat = candidates.find(candidate => preferredVariants.some(variant =>
    variant.height === candidate.height && variant.fps === candidate.fps));
  return bestPreferredFormat ?? candidates[0] ?? null;
}

type SelectVideoFormatForOptionsParams = Prettify<{
  videoData: Pick<VideoData, "videoFormats" | "videoFormatVariants">;
  options: Pick<Options, "videoQualityMode" | "videoQuality" | "enhancedBitrate" | "ext" | "videoCodec" | "audioCodec" | "dynamicRange">;
}>;
export function selectVideoFormatForOptions({ videoData, options }: SelectVideoFormatForOptionsParams) {
  return selectVideoFormatForQuality({
    videoData,
    options,
    targetExtension: resolveAutoExtension({
      extension: options.ext.video,
      mimeType: videoData.videoFormats[0]?.mimeType ?? ""
    })
  });
}
