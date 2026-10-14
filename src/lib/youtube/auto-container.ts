import { resolveVideoFormatVariants } from "./align-formats-to-container";
import { resolveAudioCodecPreference, resolveVideoCodecPreference } from "@/lib/utils/container-specs";
import { resolveAutoExtension } from "@/lib/utils/mime-types";
import type { CodecPreferences, Prettify, VideoData } from "@/types";

type ResolveAutoContainerParams = Prettify<{
  extension: string;
  videoData: Pick<VideoData, "videoFormats" | "videoFormatVariants" | "audioFormats">;
  sourceMimeType: string;
  codecPreferences: CodecPreferences;
  isAudio?: boolean;
}>;

// "Auto (match source)" matches the streams the codec settings pick, when the video offers them:
// H.264/AV1 -> MP4, VP9 -> WebM, Opus audio -> .opus, and MKV when the video container can't hold
// the chosen audio as-is. Without codec settings it matches the given source stream (issue #21)
export function resolveAutoContainer({
  extension, videoData, sourceMimeType, codecPreferences, isAudio = false
}: ResolveAutoContainerParams) {
  const preferredAudio = videoData.audioFormats.find(format =>
    resolveAudioCodecPreference(format.mimeType) === codecPreferences.audioCodec);
  if (isAudio) {
    return resolveAutoExtension({
      extension,
      mimeType: preferredAudio?.mimeType ?? sourceMimeType,
      isAudio
    });
  }

  const preferredVideo = resolveVideoFormatVariants(videoData).find(format =>
    resolveVideoCodecPreference(format.mimeType) === codecPreferences.videoCodec);
  return resolveAutoExtension({
    extension,
    mimeType: preferredVideo?.mimeType ?? sourceMimeType,
    audioMimeType: preferredAudio?.mimeType
  });
}
