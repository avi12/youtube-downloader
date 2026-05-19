import { byQualityDesc, getUniqueVideoFormats, getAudioFormats } from "./format-filters";
import { isVideoDownloadable, isVideoLive, isVideoMusic } from "@/lib/youtube/video-helpers";
import type { PlayerResponse } from "@/types";

const PROGRESSIVE_ITAG_PRIORITY = [22, 18] as const;
const YT_INITIAL_PLAYER_RESPONSE_PATTERN = /var ytInitialPlayerResponse\s*=\s*(.+?);\s*(?:var\s|<\/script>)/s;

function extractProgressiveUrl(playerResponse: PlayerResponse) {
  const formats = playerResponse.streamingData?.formats ?? [];
  for (const itag of PROGRESSIVE_ITAG_PRIORITY) {
    const format = formats.find(formatItem => formatItem.itag === itag && formatItem.url);
    if (format?.url) {
      return format.url;
    }
  }

  return null;
}

type VideoDataParams = {
  playerResponse: PlayerResponse;
  clientVersion: string;
  clientName: number;
};
function extractSabrConfig({ playerResponse, clientVersion, clientName }: VideoDataParams) {
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

export function buildVideoData({ playerResponse, clientVersion, clientName }: VideoDataParams) {
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
    captionTracks: allCaptionTracks,
    sabrConfig: extractSabrConfig({
      playerResponse,
      clientVersion,
      clientName
    }),
    progressiveUrl: extractProgressiveUrl(playerResponse)
  };
}

export function extractPlayerResponseFromHtml(html: string) {
  try {
    const [, playerJson = ""] = html.match(YT_INITIAL_PLAYER_RESPONSE_PATTERN) ?? [];
    const parsed: PlayerResponse = JSON.parse(playerJson);
    return parsed;
  } catch {
    return null;
  }
}
