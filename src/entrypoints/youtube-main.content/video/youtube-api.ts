import { byBitrateDesc, getAudioFormats, getCaptionTracks, getUniqueVideoFormats } from "./video-format-filters";
import { isVideoDownloadable, isVideoLive, isVideoMusic } from "@/lib/youtube/video-helpers";
import type { PlayerResponse } from "@/types";

function extractSabrConfig({ playerResponse, clientVersion, clientName }: {
  playerResponse: PlayerResponse;
  clientVersion: string;
  clientName: number;
}) {
  const serverAbrStreamingUrl = playerResponse.streamingData?.serverAbrStreamingUrl;
  const videoPlaybackUstreamerConfig = playerResponse.playerConfig
    ?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig;
  if (!serverAbrStreamingUrl || !videoPlaybackUstreamerConfig) {
    return null;
  }

  return {
    serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig,
    clientName,
    clientVersion,
    formats: playerResponse.streamingData?.adaptiveFormats ?? []
  };
}

export function buildVideoData({
  playerResponse, clientVersion, clientName, preferredAudioLanguage = "", preferredCaptionLanguage = ""
}: {
  playerResponse: PlayerResponse;
  clientVersion: string;
  clientName: number;
  preferredAudioLanguage?: string;
  preferredCaptionLanguage?: string;
}) {
  const isDownloadable = isVideoDownloadable(playerResponse);
  const isLive = isVideoLive(playerResponse);
  const isMusic = isVideoMusic(playerResponse);
  const allFormats = (isDownloadable ? playerResponse.streamingData?.adaptiveFormats : null)
    ?.toSorted(byBitrateDesc) ?? [];
  const { videoDetails } = playerResponse;
  return {
    playerResponse,
    videoId: videoDetails?.videoId ?? "",
    title: videoDetails?.title ?? "",
    isMusic,
    isDownloadable,
    isLive,
    videoFormats: getUniqueVideoFormats(allFormats, import.meta.env.FIREFOX),
    audioFormats: getAudioFormats(allFormats, preferredAudioLanguage),
    captionTracks: getCaptionTracks(playerResponse, preferredCaptionLanguage || preferredAudioLanguage),
    sabrConfig: extractSabrConfig({
      playerResponse,
      clientVersion,
      clientName
    })
  };
}

export function extractPlayerResponseFromHtml(html: string) {
  try {
    const match = html.match(/var ytInitialPlayerResponse\s*=\s*(.+?);\s*(?:var\s|<\/script>)/s);
    const parsed: PlayerResponse = JSON.parse(match?.[1] ?? "");
    return parsed;
  } catch {
    return null;
  }
}
