import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import type { AdaptiveFormatItem, PlayerResponse } from "@/types";

const WEB_CLIENT_VERSION = "2.20250101.00.00";

export async function fetchCdnUrlsViaWebClient({ videoId, videoItag, audioItag, extraAudioItags, visitorData }: {
  videoId: string;
  videoItag: number | undefined;
  audioItag: number | undefined;
  extraAudioItags: number[];
  visitorData?: string;
}) {
  const playerRequest: InnertubePlayerRequest = {
    videoId,
    context: {
      client: {
        clientName: InnertubeClientName.WebEmbeddedPlayer,
        clientVersion: WEB_CLIENT_VERSION
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };

  try {
    const response = await fetch(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(visitorData && {
            "X-Goog-Visitor-Id": visitorData
          })
        },
        body: JSON.stringify(playerRequest)
      }
    );
    if (!response.ok) {
      console.warn("[ytdl:bg] Web client player fetch failed:", response.status);
      return null;
    }

    const playerData: PlayerResponse = await response.json();
    const formats: AdaptiveFormatItem[] = playerData.streamingData?.adaptiveFormats ?? [];

    const playability = playerData.playabilityStatus?.status;
    console.warn("[ytdl:bg] Web client formats:", formats.length, "with URLs:", formats.filter(format => format.url).length, "playability:", playability);

    const resolvedVideoUrl = videoItag !== undefined
      ? (formats.find(format => format.itag === videoItag)?.url ?? null)
      : null;
    const resolvedAudioUrl = audioItag !== undefined
      ? (formats.find(format => format.itag === audioItag)?.url ?? null)
      : null;
    const resolvedExtraUrls = extraAudioItags.map(itag => formats.find(format => format.itag === itag)?.url ?? null);

    console.warn("[ytdl:bg] Web client CDN URLs:", {
      hasVideoUrl: !!resolvedVideoUrl,
      hasAudioUrl: !!resolvedAudioUrl
    });
    return {
      resolvedVideoUrl,
      resolvedAudioUrl,
      resolvedExtraUrls
    };
  } catch (error) {
    console.warn("[ytdl:bg] Web client player fetch error:", error);
    return null;
  }
}
