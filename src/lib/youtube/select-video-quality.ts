import { createVideoFormatPreference, resolveVideoFormatVariants } from "./align-formats-to-container";
import { resolveAutoContainer } from "./auto-container";
import { filterVideoFormatsByEnhancedBitrate } from "./format-display";
import { listChoices } from "@/lib/utils/choices";
import {
  MaxFrameRate,
  VideoQualityMode,
  type Options,
  type Prettify,
  type VideoData
} from "@/types";

const FRAME_RATE_LIMITS: Record<MaxFrameRate, Prettify<{
  cap: number;
  label: string;
  description: string;
}>> = {
  [MaxFrameRate.Any]: {
    cap: Infinity,
    label: "Any",
    description: "Whatever the video has"
  },
  [MaxFrameRate.Fps60]: {
    cap: 60,
    label: "60 fps",
    description: "Skips higher frame rates"
  },
  [MaxFrameRate.Fps30]: {
    cap: 30,
    label: "30 fps",
    description: "Smaller files, less smooth motion"
  }
};

export const MAX_FRAME_RATE_CHOICES = listChoices({
  values: Object.values(MaxFrameRate),
  texts: FRAME_RATE_LIMITS
});

type QualityOptions = Pick<Options,
  "videoQualityMode" | "videoQuality" | "maxFrameRate" | "enhancedBitrate" | "videoCodec" | "audioCodec" | "dynamicRange"
>;

type QualityVideoData = Pick<VideoData, "videoFormats" | "videoFormatVariants">;

// The per-resolution list keeps each resolution's best stream, usually its highest frame rate,
// so a cap below it looks through every stream instead; a video with nothing under the cap
// keeps its own frame rates
function listQualityCandidates({ videoData, options }: {
  videoData: QualityVideoData;
  options: QualityOptions;
}) {
  const candidates = filterVideoFormatsByEnhancedBitrate(videoData.videoFormats, options.enhancedBitrate);
  const { cap } = FRAME_RATE_LIMITS[options.maxFrameRate];
  const isOverCap = candidates.some(format => (format.fps ?? 0) > cap);
  if (!isOverCap) {
    return candidates;
  }

  const variants = filterVideoFormatsByEnhancedBitrate(resolveVideoFormatVariants(videoData), options.enhancedBitrate);
  const cappedFormats = variants.filter(format => (format.fps ?? 0) <= cap);
  return cappedFormats.length ? cappedFormats : candidates;
}

// "Best" stops at the highest quality the container's preferred codec offers, like
// yt-dlp's -f [vcodec^=avc1] for MP4 (H.264 tops out at 1080p); an explicit pick is kept
type SelectVideoFormatForQualityParams = Prettify<{
  videoData: QualityVideoData;
  options: QualityOptions;
  targetExtension: string;
}>;
export function selectVideoFormatForQuality({
  videoData, options, targetExtension
}: SelectVideoFormatForQualityParams) {
  const candidates = listQualityCandidates({
    videoData,
    options
  });
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
  videoData: QualityVideoData & Pick<VideoData, "audioFormats">;
  options: QualityOptions & Pick<Options, "ext">;
}>;
export function selectVideoFormatForOptions({ videoData, options }: SelectVideoFormatForOptionsParams) {
  return selectVideoFormatForQuality({
    videoData,
    options,
    targetExtension: resolveAutoContainer({
      extension: options.ext.video,
      videoData,
      sourceMimeType: videoData.videoFormats[0]?.mimeType ?? "",
      codecPreferences: options
    })
  });
}
