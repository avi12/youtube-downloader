import { isVideoDownloadable, isVideoLive, isVideoMusic } from "@/lib/utils";
import type { AdaptiveFormatItem, PlayerResponse, SabrConfig } from "@/types";

// ─── Format parsing utilities ─────────────────────────────────────────────────

export function sortFormatsByBitrate(
  formats: AdaptiveFormatItem[]
) {
  return [...formats].sort((formatA, formatB) => formatB.bitrate - formatA.bitrate);
}

export function getUniqueVideoFormats(
  formats: AdaptiveFormatItem[]
) {
  const videoFormats = formats.filter(format => format.mimeType.startsWith("video")
  );
  // Deduplicate by height + premium status so both standard and enhanced
  // bitrate variants appear as separate dropdown entries.
  const seen = new Set<string>();

  return videoFormats.filter(format => {
    if (!format.height) {
      return false;
    }

    const isPremium = format.qualityLabel?.includes("Premium") ?? false;
    const key = `${format.height}-${isPremium}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getAudioFormats(
  formats: AdaptiveFormatItem[]
) {
  const audioFormats = formats.filter(format => format.mimeType.startsWith("audio"));
  // Deduplicate by itag + audioTrack.id so different language tracks
  // with the same itag (e.g., original + dubbed, both itag 140) are preserved.
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

export function getVideoQualityLabel(format: AdaptiveFormatItem) {
  return Math.min(format.height ?? 0, format.width ?? 0);
}

export function getFormatsFromPlayerResponse(
  playerResponse: PlayerResponse
) {
  return playerResponse.streamingData?.adaptiveFormats ?? [];
}

// ─── VideoData assembly ───────────────────────────────────────────────────────

export function extractSabrConfig({ playerResponse, clientVersion, clientName }: {
  playerResponse: PlayerResponse;
  clientVersion: string;
  clientName: number;
}): SabrConfig | null {
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

  const allFormats = isDownloadable
    ? sortFormatsByBitrate(getFormatsFromPlayerResponse(playerResponse))
    : [];

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
    sabrConfig: extractSabrConfig({ playerResponse, clientVersion, clientName })
  };
}

// ─── Player response extraction from raw HTML ────────────────────────────────

export function extractPlayerResponseFromHtml(html: string) {
  const marker = "var ytInitialPlayerResponse = ";
  const startIndex = html.indexOf(marker);
  if (startIndex === -1) {
    return null;
  }

  const jsonStart = startIndex + marker.length;
  let depth = 0;
  let end = jsonStart;

  for (let iChar = jsonStart; iChar < html.length; iChar++) {
    if (html[iChar] === "{") {
      depth++;
    } else if (html[iChar] === "}") {
      depth--;

      if (depth === 0) {
        end = iChar + 1;
        break;
      }
    }
  }

  try {
    const parsed: PlayerResponse = JSON.parse(html.slice(jsonStart, end));
    return parsed;
  } catch {
    return null;
  }
}

// ─── Playlist data ────────────────────────────────────────────────────────────

export function extractPlaylistIdFromUrl(url: string) {
  try {
    return new URLSearchParams(new URL(url).search).get("list");
  } catch {
    return null;
  }
}
