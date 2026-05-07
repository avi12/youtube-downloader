import { isVideoDownloadable, isVideoLive, isVideoMusic } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, PlayerResponse } from "@/types";

function getUniqueVideoFormats(formats: AdaptiveFormatItem[]) {
  const videoFormats = formats.filter(format => format.mimeType.startsWith("video"));
  // Dedup by height + premium status so standard and enhanced bitrate variants are distinct.
  const seen = new Set<string>();

  return videoFormats.filter(format => {
    if (!format.height) {
      return false;
    }

    const isPremium = (format.qualityLabel ?? "").includes("Premium");
    const key = `${format.height}-${isPremium}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getAudioFormats(formats: AdaptiveFormatItem[]) {
  const audioFormats = formats.filter(format => format.mimeType.startsWith("audio"));
  // Dedup by itag + audioTrack.id so different language tracks with the same itag
  // (e.g. original + dubbed) are preserved.
  const seenKeys = new Set<string>();
  return audioFormats.filter(format => {
    const key = `${format.itag}:${format.audioTrack?.id ?? ""}`;
    if (seenKeys.has(key)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
}

function byBitrateDesc(formatA: AdaptiveFormatItem, formatB: AdaptiveFormatItem) {
  return formatB.bitrate - formatA.bitrate;
}

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
    ?.toSorted(byBitrateDesc) ?? [];

  const { videoDetails } = playerResponse;
  return {
    playerResponse,
    videoId: videoDetails?.videoId ?? "",
    title: videoDetails?.title ?? "",
    isMusic,
    isDownloadable,
    isLive,
    videoFormats: getUniqueVideoFormats(allFormats),
    audioFormats: getAudioFormats(allFormats),
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
