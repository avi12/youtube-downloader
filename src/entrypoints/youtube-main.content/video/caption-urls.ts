import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { InnertubeClientName, type InnertubePlayerRequest } from "@/lib/youtube/innertube";
import { orderCaptionsByPreference, resolveCaptionLanguageMode } from "@/lib/youtube/video-helpers";
import { getYtcfg, YtcfgKey } from "@/lib/youtube/ytcfg";
import { type CaptionTrack, type PlayerResponse } from "@/types";

const PLAYER_API_PATH = "/youtubei/v1/player?prettyPrint=false";
const HEADER_CONTENT_TYPE = "Content-Type";
const HEADER_GOOG_API_KEY = "X-Goog-Api-Key";
const HEADER_GOOG_VISITOR_ID = "X-Goog-Visitor-Id";
const CONTENT_TYPE_JSON = "application/json";
const DEFAULT_CAPTION_LANGUAGE = "en";
const DEFAULT_CAPTION_REGION = "US";

type ResolveOrderedCaptionTracksParams = {
  captionTracks: CaptionTrack[];
  selectedCaptionVssId: string | undefined;
  downloadExtras: boolean;
};
export function resolveOrderedCaptionTracks({
  captionTracks, selectedCaptionVssId, downloadExtras
}: ResolveOrderedCaptionTracksParams) {
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
    const nativeTracks = allCaptionTracks.filter(track => !track.translationLanguageCode);
    const isSelectedTranslated = primaryCaptionTrack?.translationLanguageCode;
    return isSelectedTranslated ? [primaryCaptionTrack, ...nativeTracks] : nativeTracks;
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
    [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
    [HEADER_GOOG_API_KEY]: apiKey
  };
  if (visitorData) {
    headers[HEADER_GOOG_VISITOR_ID] = visitorData;
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
          hl: getYtcfg(YtcfgKey.Hl) ?? DEFAULT_CAPTION_LANGUAGE,
          gl: getYtcfg(YtcfgKey.Gl) ?? DEFAULT_CAPTION_REGION,
          visitorData: visitorData ?? ""
        }
      }
    };
    const response = await fetch(PLAYER_API_PATH, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(playerRequest)
    });
    if (!response.ok) {
      return new Map<string, string>();
    }

    const data: PlayerResponse = await response.json();
    const freshTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return new Map(freshTracks.map(track => [track.vssId, track.baseUrl]));
  } catch {
    return new Map<string, string>();
  }
}
