import { byQualityDesc, getUniqueVideoFormats, getAudioFormats } from "./format-filters";
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

export function buildVideoData({ playerResponse, clientVersion, clientName }: {
  playerResponse: PlayerResponse;
  clientVersion: string;
  clientName: number;
}) {
  const isDownloadable = isVideoDownloadable(playerResponse);
  const isLive = isVideoLive(playerResponse);
  const isMusic = isVideoMusic(playerResponse);

  const allFormats = (isDownloadable ? playerResponse.streamingData?.adaptiveFormats : null)
    ?.toSorted(byQualityDesc) ?? [];

  const { videoDetails } = playerResponse;
  const allCaptionTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return {
    playerResponse,
    videoId: videoDetails?.videoId ?? "",
    title: videoDetails?.title ?? "",
    isMusic,
    isDownloadable,
    isLive,
    videoFormats: getUniqueVideoFormats(allFormats),
    audioFormats: getAudioFormats(allFormats),
    captionTracks: allCaptionTracks.filter(track => track.kind !== "asr"),
    sabrConfig: extractSabrConfig({
      playerResponse,
      clientVersion,
      clientName
    })
  };
}

export function extractPlayerResponseFromHtml(html: string) {
  try {
    const [, playerJson = ""] = html.match(/var ytInitialPlayerResponse\s*=\s*(.+?);\s*(?:var\s|<\/script>)/s) ?? [];
    const parsed: PlayerResponse = JSON.parse(playerJson);
    return parsed;
  } catch {
    return null;
  }
}
