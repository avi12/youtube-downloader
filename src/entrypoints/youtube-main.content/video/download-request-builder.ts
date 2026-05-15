import { fetchCaptionWebVttData } from "./caption-fetch";
import type { DownloadParams } from "./download-execute";
import { buildVideoMetadata } from "./video-data";
import type { CaptionTrack, DownloadRequest, AdaptiveFormatItem } from "@/types";

export type ResolvedDownloadData = {
  sabrConfig: DownloadRequest["sabrConfig"];
  poToken: string | null;
  sabrUrl: string | null;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
  orderedCaptionTracks: CaptionTrack[];
  captionVttDataPromise: Promise<(string | null)[]>;
  resolvedVideoUrl: string | null;
  resolvedAudioUrl: string | null;
  resolvedExtraAudioUrls: (string | null)[];
};

export async function buildEnrichedRequest({ params, resolved }: {
  params: DownloadParams;
  resolved: ResolvedDownloadData;
}) {
  const { type, videoId, videoItag, audioItag, filenameOutput, isIframeFallback } = params;
  const { playlistId, playlistTitle, playlistTotalCount } = params;
  const {
    sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, extraAudioFormats,
    orderedCaptionTracks, captionVttDataPromise,
    resolvedVideoUrl, resolvedAudioUrl, resolvedExtraAudioUrls
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
    primaryAudioLanguageCode: audioFormat?.audioTrack?.id?.split(".")[0] ?? "",
    captionTracks: orderedCaptionTracks,
    captionVttData: await captionVttDataPromise,
    metadata,
    resolvedVideoUrl,
    resolvedAudioUrl,
    resolvedExtraAudioUrls,
    playlistId,
    playlistTitle,
    playlistTotalCount
  };
}

export { fetchCaptionWebVttData };
