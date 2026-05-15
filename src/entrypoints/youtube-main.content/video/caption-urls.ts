import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { orderCaptionsByPreference, resolveCaptionLanguageMode } from "@/lib/youtube/video-helpers";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import { type CaptionTrack, type PlayerResponse } from "@/types";

export function resolveOrderedCaptionTracks(
  captionTracks: CaptionTrack[],
  selectedCaptionVssId: string | undefined,
  downloadExtras: boolean
) {
  const options = CONTENT_OPTIONS;
  const captionMode = resolveCaptionLanguageMode({
    captionMode: options.captionLanguageMode,
    audioMode: options.audioTrackLanguageMode
  });
  const allCaptionTracks = orderCaptionsByPreference({
    captionTracks,
    languageMode: captionMode,
    locale: document.documentElement.lang,
    browserLanguage: navigator.language,
    customLanguage: options.customLanguage
  });
  const primaryCaptionTrack = selectedCaptionVssId
    ? (allCaptionTracks.find(track => track.vssId === selectedCaptionVssId) ?? allCaptionTracks[0])
    : allCaptionTracks[0];
  if (downloadExtras) {
    return allCaptionTracks;
  }

  return primaryCaptionTrack ? [primaryCaptionTrack] : [];
}

export async function fetchFreshCaptionUrls(videoId: string) {
  const apiKey = getYtcfg(YtcfgKey.InnertubeApiKey);
  if (!apiKey) {
    return new Map<string, string>();
  }

  const visitorData = getYtcfg(YtcfgKey.VisitorData);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey
  };
  if (visitorData) {
    headers["X-Goog-Visitor-Id"] = visitorData;
  }

  try {
    const playerRequest: InnertubePlayerRequest = {
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: getYtcfg(YtcfgKey.Sts)
        }
      },
      context: {
        client: {
          clientName: InnertubeClientName.Web,
          clientVersion: getYtcfg(YtcfgKey.ClientVersion) ?? "",
          hl: getYtcfg(YtcfgKey.Hl) ?? "en",
          gl: getYtcfg(YtcfgKey.Gl) ?? "US",
          visitorData: visitorData ?? ""
        }
      }
    };
    const resp = await fetch("/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(playerRequest)
    });
    if (!resp.ok) {
      return new Map<string, string>();
    }

    const data: PlayerResponse = await resp.json();
    const freshTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return new Map(freshTracks.map(track => [track.vssId, track.baseUrl]));
  } catch {
    return new Map<string, string>();
  }
}
