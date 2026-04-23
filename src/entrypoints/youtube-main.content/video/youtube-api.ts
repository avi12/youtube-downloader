import { isVideoDownloadable, isVideoLive, isVideoMusic } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, CaptionTrack, PlayerResponse } from "@/types";

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

function getAudioFormats(formats: AdaptiveFormatItem[], preferredLanguage: string) {
  const audioFormats = formats.filter(format => format.mimeType.startsWith("audio"));
  // Dedup by itag + audioTrack.id so different language tracks with the same itag
  // (e.g. original + dubbed) are preserved.
  const seenKeys = new Set<string>();
  const deduped = audioFormats.filter(format => {
    const key = `${format.itag}:${format.audioTrack?.id ?? ""}`;
    if (seenKeys.has(key)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
  if (!preferredLanguage || deduped.every(format => !format.audioTrack)) {
    return deduped;
  }

  // Normalize to bare language code: "en-US" → "en".
  const langCode = preferredLanguage.toLowerCase().split("-")[0];

  function isPreferredTrack(format: AdaptiveFormatItem) {
    const trackId = format.audioTrack?.id?.toLowerCase() ?? "";
    // audioTrack.id may be "es", "und:es", "2:dubbed:Spanish", etc.
    return trackId === langCode || trackId.split(":").includes(langCode);
  }

  const preferred = deduped.filter(format => isPreferredTrack(format));
  const rest = deduped.filter(format => !isPreferredTrack(format));
  return [...preferred, ...rest];
}

function getCaptionTracks(playerResponse: PlayerResponse, preferredLanguage: string): CaptionTrack[] {
  const allTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const manualTracks = allTracks.filter(track => track.kind !== "asr");
  if (!preferredLanguage || manualTracks.length === 0) {
    return manualTracks;
  }

  const langCode = preferredLanguage.toLowerCase().split("-")[0];
  const preferred = manualTracks.filter(track => track.languageCode.toLowerCase().split("-")[0] === langCode);
  const rest = manualTracks.filter(track => track.languageCode.toLowerCase().split("-")[0] !== langCode);
  return [...preferred, ...rest];
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

export function buildVideoData({ playerResponse, clientVersion, clientName, preferredAudioLanguage = "", preferredCaptionLanguage = "" }: {
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
    videoFormats: getUniqueVideoFormats(allFormats),
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
