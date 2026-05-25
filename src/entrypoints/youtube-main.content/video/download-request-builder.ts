import { fetchCaptionWebVttData } from "./caption-fetch";
import type { DownloadParams } from "./download-execute";
import { buildVideoMetadata } from "./video-data";
import { getCurrentVideoAudioLanguage, normalizeLanguageCode } from "@/lib/youtube/audio-format-helpers";
import type { CaptionTrack, DownloadRequest, AdaptiveFormatItem } from "@/types";

export type ResolvedDownloadData = {
  sabrConfig: DownloadRequest["sabrConfig"];
  poToken: string | null;
  sabrUrl: string | null;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
  orderedCaptionTracks: CaptionTrack[];
  sourceCaptionTracks: CaptionTrack[];
  captionVttDataPromise: Promise<(string | null)[]>;
  resolvedVideoUrl: string | null;
  resolvedAudioUrl: string | null;
  resolvedExtraAudioUrls: (string | null)[];
  progressiveUrl: string | null;
};

// Single-track videos don't carry the `audioTrack.id` on the adaptive format
// (YouTube only attaches `audioTrack` for multi-language uploads), so the
// previous `.split(".")[0]` returned "". With no language metadata FFmpeg
// leaves the stream untagged and VLC falls back to "[English]" regardless of
// the actual spoken language. Resolve the source language via this fallback
// chain so a Hebrew upload tags as `language=he` and surfaces correctly:
//   1. Explicit per-format audioTrack.id (multi-track videos)
//   2. HTML5 <video>.audioTracks active entry (single-track videos that the
//      player has already populated)
//   3. First non-translated caption track (typically the source language)
type ResolveLanguageParams = {
  audioFormat: AdaptiveFormatItem | null;
  sourceCaptionTracks: CaptionTrack[];
};
function resolvePrimaryAudioLanguageCode({ audioFormat, sourceCaptionTracks }: ResolveLanguageParams) {
  const trackId = audioFormat?.audioTrack?.id;
  if (trackId) {
    return trackId.split(".")[0];
  }

  const liveLanguage = getCurrentVideoAudioLanguage();
  if (liveLanguage) {
    return liveLanguage;
  }

  const sourceTrack = sourceCaptionTracks.find(track => !track.translationLanguageCode);
  if (sourceTrack?.languageCode) {
    return normalizeLanguageCode(sourceTrack.languageCode);
  }

  return "";
}

type BuildEnrichedRequestParams = {
  params: DownloadParams;
  resolved: ResolvedDownloadData;
};
export async function buildEnrichedRequest({ params, resolved }: BuildEnrichedRequestParams) {
  const { type, videoId, videoItag, audioItag, filenameOutput, isIframeFallback } = params;
  const { playlistId, playlistTitle, playlistTotalCount } = params;
  const {
    sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, extraAudioFormats,
    orderedCaptionTracks, sourceCaptionTracks, captionVttDataPromise,
    resolvedVideoUrl, resolvedAudioUrl, resolvedExtraAudioUrls, progressiveUrl
  } = resolved;
  const metadata = await buildVideoMetadata(videoId);
  return {
    type,
    videoId,
    videoItag,
    audioItag,
    filenameOutput,
    isIframeFallback,
    sabrConfig,
    poToken: poToken ?? undefined,
    sabrUrl: sabrUrl ?? undefined,
    videoFormat,
    audioFormat,
    additionalAudioFormats: extraAudioFormats,
    primaryAudioLabel: audioFormat?.audioTrack?.displayName ?? "",
    primaryAudioLanguageCode: resolvePrimaryAudioLanguageCode({
      audioFormat,
      sourceCaptionTracks
    }),
    captionTracks: orderedCaptionTracks,
    captionVttData: await captionVttDataPromise,
    metadata,
    resolvedVideoUrl,
    resolvedAudioUrl,
    resolvedExtraAudioUrls,
    progressiveUrl,
    playlistId,
    playlistTitle,
    playlistTotalCount
  };
}

export { fetchCaptionWebVttData };
